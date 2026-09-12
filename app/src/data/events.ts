// Local event log — primary read path is AsyncStorage so the v1 monolith
// stays snappy and demo mode keeps working without auth. When the user is
// signed in with a real campus_id claim:
//   - every appendEvent ALSO fires a background dispatch to the v2 server
//     (best-effort, never blocks the UI and never throws). [step 7c1]
//   - Supabase Realtime channels stream INSERTs from other devices back
//     into the store via mergeRemoteEvent. [step 7c2 — see realtime.ts]
//
// Dedupe rule: when this device wrote a row to the server, we record the
// returned server id in `dispatchedIds`; the realtime echo for that id is
// skipped so the local event is not duplicated.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../supabase';
import {
  postActivateIncident,
  postChatMessage,
  postClearIncident,
  postClearThreat,
  postDeclareThreat,
  postIncidentLocation,
  postMassMessage,
  postResetIncident,
  postStaffBroadcast,
} from './server';

// Demo mode (no auth) shares one bucket on the device so the v1 multi-profile
// flow (one device flipping between Student → Staff → Parent) still sees a
// shared event log. When the user signs in to a real campus, we scope to
// the auth UID so two people sharing a phone don't see each other's data.
const DEMO_EVENTS_KEY = 'beacon5.events.v1';
const MAX_EVENTS = 500;

let storageKey = DEMO_EVENTS_KEY;

type Listener<E> = (events: E[]) => void;

interface Store<E> {
  events: E[];
  listeners: Set<Listener<E>>;
  hydrated: boolean;
  hydrating: Promise<void> | null;
}

// One global, type-erased store. `subscribeToEvents<E>` and
// `appendEvent<E>` re-type it at the call site. The runtime contract
// (events are JSON-serializable objects with a stable `id`) is enforced
// by AsyncStorage's string interface; the type parameter is purely a
// compile-time convenience for the v1 monolith.
const store: Store<unknown> = {
  events: [],
  listeners: new Set(),
  hydrated: false,
  hydrating: null,
};

async function hydrate(): Promise<void> {
  if (store.hydrated) return;
  if (store.hydrating) return store.hydrating;
  const keyAtStart = storageKey;
  store.hydrating = (async () => {
    try {
      const raw = await AsyncStorage.getItem(keyAtStart);
      // If the scope changed while we were reading (e.g. sign-in mid-hydrate),
      // discard the read — the new hydrate cycle will pull the right bucket.
      if (keyAtStart !== storageKey) return;
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) store.events = parsed;
      }
    } catch {
      // corrupted store — start fresh
    }
    if (keyAtStart === storageKey) {
      store.hydrated = true;
      notify();
    }
  })();
  return store.hydrating;
}

async function persist(): Promise<void> {
  try {
    const trimmed = store.events.slice(-MAX_EVENTS);
    if (trimmed.length === 0) {
      await AsyncStorage.removeItem(storageKey);
    } else {
      await AsyncStorage.setItem(storageKey, JSON.stringify(trimmed));
    }
  } catch {
    // best effort
  }
}

// Called from AuthContext when a real auth session lands (or goes away).
// `userId === null` falls back to the shared demo bucket.
export function setStorageScope(userId: string | null): void {
  const nextKey = userId ? `beacon5.events.user.${userId}` : DEMO_EVENTS_KEY;
  if (nextKey === storageKey) return;
  storageKey = nextKey;
  // Drop the in-memory store; the next subscribe-or-append will hydrate
  // from the new bucket. Don't touch the previous bucket on disk — it
  // belongs to the previous account and will be there when they return.
  dispatchedIds.clear();
  serverIncidentIds.clear();
  activeLocalIncidentByStudent.clear();
  store.events = [];
  store.hydrated = false;
  store.hydrating = null;
  notify();
  void hydrate();
}

function notify(): void {
  for (const listener of store.listeners) {
    try {
      (listener as Listener<unknown>)(store.events);
    } catch {
      // a listener throwing must not break the others
    }
  }
}

export function subscribeToEvents<E>(onEvents: (events: E[]) => void): () => void {
  store.listeners.add(onEvents as Listener<unknown>);
  if (store.hydrated) {
    // Hand the current state over once so the caller renders synchronously.
    // If we're mid-hydrate or unstarted, hydrate()'s notify will fire it
    // through the listener set instead.
    onEvents(store.events as E[]);
  } else {
    void hydrate();
  }
  return () => {
    store.listeners.delete(onEvents as Listener<unknown>);
  };
}

export async function appendEvent<E>(event: E): Promise<void> {
  await hydrate();
  store.events = [...store.events, event];
  await persist();
  notify();
  // Fire-and-forget: never block the UI on server I/O, never let
  // a server error surface to the v1 monolith.
  void dispatchToServer(event);
}

// ─── remote merge (7c2) ───────────────────────────────────────────
// Server ids we know are echoes of our own writes — skip on receipt.
// Bounded to ~200 entries; FIFO eviction is good enough since the
// realtime echo lands within seconds.
const dispatchedIds = new Set<string>();
const DISPATCHED_LRU_LIMIT = 200;

export function markDispatched(serverId: string): void {
  if (!serverId) return;
  dispatchedIds.add(serverId);
  if (dispatchedIds.size > DISPATCHED_LRU_LIMIT) {
    const first = dispatchedIds.values().next().value;
    if (first) dispatchedIds.delete(first);
  }
}

export async function mergeRemoteEvent<E extends { id: string }>(event: E): Promise<void> {
  if (!event || !event.id) return;
  if (dispatchedIds.has(event.id)) return;
  await hydrate();
  if ((store.events as Array<{ id: string }>).some((e) => e.id === event.id)) return;
  store.events = [...store.events, event];
  await persist();
  notify();
}

export function resetEventStoreForSignOut(): void {
  // Hard reset on sign-out: drop the in-memory store + dedupe sets so
  // a fresh sign-in starts clean. AsyncStorage stays — it's tied to the
  // device, not the account — and re-hydrates on next subscribe.
  dispatchedIds.clear();
  serverIncidentIds.clear();
  activeLocalIncidentByStudent.clear();
  store.events = [];
  store.hydrated = false;
  store.hydrating = null;
  notify();
}

// ─── local ↔ server incident id map ───────────────────────────────
// The monolith mints its own incident ids (`inc-…`) and appends
// LOCATION_UPDATEs *before* the BEACON_ACTIVATED event (it acquires a
// fix first), while the server hands back a uuid only once activation
// lands. So:
//   - lookups return a promise that resolves when the id is known;
//   - the map is mirrored to AsyncStorage because the background
//     location task runs in its own JS context and can't see module state;
//   - ids that already look like uuids (events that arrived via realtime
//     on a staff device) pass straight through.
const SERVER_ID_KEY_PREFIX = 'beacon5.serverIncident.';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_WAIT_MS = 30_000;

interface Deferred { promise: Promise<string | null>; resolve: (v: string | null) => void }
const serverIncidentIds = new Map<string, Deferred>();
const activeLocalIncidentByStudent = new Map<string, string>();

function deferredFor(localId: string): Deferred {
  let d = serverIncidentIds.get(localId);
  if (d) return d;
  let resolve: (v: string | null) => void = () => undefined;
  const promise = new Promise<string | null>((r) => {
    resolve = r;
    setTimeout(() => r(null), ID_WAIT_MS);
  });
  d = { promise, resolve };
  serverIncidentIds.set(localId, d);
  return d;
}

function rememberServerIncidentId(localId: string, serverId: string): void {
  deferredFor(localId).resolve(serverId);
  void AsyncStorage.setItem(SERVER_ID_KEY_PREFIX + localId, serverId).catch(() => undefined);
}

async function serverIncidentIdFor(localOrServerId: string): Promise<string | null> {
  if (UUID_RE.test(localOrServerId)) return localOrServerId;
  const existing = serverIncidentIds.get(localOrServerId);
  if (existing) return existing.promise;
  // Cold miss (e.g. background task context) — try disk before waiting.
  try {
    const stored = await AsyncStorage.getItem(SERVER_ID_KEY_PREFIX + localOrServerId);
    if (stored) {
      rememberServerIncidentId(localOrServerId, stored);
      return stored;
    }
  } catch {
    // fall through to the deferred
  }
  return deferredFor(localOrServerId).promise;
}

function forgetIncident(localId: string): void {
  serverIncidentIds.delete(localId);
  void AsyncStorage.removeItem(SERVER_ID_KEY_PREFIX + localId).catch(() => undefined);
}

// Latest BEACON_ACTIVATED id for a student in the local store — on a staff
// device this is already the server uuid (it arrived via realtime).
function latestActivationIdFor(studentId: string): string | null {
  const evs = store.events as Array<{ type: string; studentId?: string; id: string }>;
  for (let i = evs.length - 1; i >= 0; i--) {
    const e = evs[i];
    if (e.type === 'BEACON_RESET' && e.studentId === studentId) return null;
    if (e.type === 'BEACON_ACTIVATED' && e.studentId === studentId) return e.id;
  }
  return null;
}

// ─── server dispatch (7c1) ────────────────────────────────────────
// Maps a BeaconEvent to the appropriate /v1/* server route. Runs
// only when the caller is signed in with a real campus claim. Demo
// mode and unauth'd users skip dispatch entirely. Each path is
// independently try/catch'd so a single failure (validation, FK,
// network) is logged but never propagates.

interface BeaconEventLike {
  type: string;
  [k: string]: unknown;
}

async function isCampusMember(): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  const claims = data.session?.user?.app_metadata as { campus_id?: string } | undefined;
  return typeof claims?.campus_id === 'string' && claims.campus_id.length > 0;
}

function coerceCoords(c: unknown): { lat: number; lng: number; accuracy?: number } | undefined {
  if (!c || typeof c !== 'object') return undefined;
  const o = c as { latitude?: number; longitude?: number; lat?: number; lng?: number; accuracy?: number | null };
  const lat = typeof o.latitude === 'number' ? o.latitude : o.lat;
  const lng = typeof o.longitude === 'number' ? o.longitude : o.lng;
  if (typeof lat !== 'number' || typeof lng !== 'number') return undefined;
  const accuracy = typeof o.accuracy === 'number' ? o.accuracy : undefined;
  return { lat, lng, ...(accuracy !== undefined ? { accuracy } : {}) };
}

type V1Audience = 'students' | 'parents' | 'teachers' | 'everyone' | 'both';
function normalizeAudience(a: V1Audience): Array<'students' | 'parents' | 'teachers' | 'everyone'> {
  if (a === 'both') return ['students', 'parents'];
  return [a];
}

async function dispatchToServer<E>(raw: E): Promise<void> {
  const event = raw as unknown as BeaconEventLike;
  if (!event || typeof event !== 'object' || typeof event.type !== 'string') return;

  try {
    if (!(await isCampusMember())) return;
  } catch {
    return;
  }

  try {
    switch (event.type) {
      case 'BEACON_ACTIVATED': {
        const localId = typeof event.id === 'string' ? event.id : '';
        const studentId = typeof event.studentId === 'string' ? event.studentId : '';
        if (localId && studentId) activeLocalIncidentByStudent.set(studentId, localId);
        const coords = coerceCoords(event.coords);
        let r: { id: string; alreadyActive?: boolean } | null = null;
        try {
          r = await postActivateIncident({
            ...(coords ? { lastKnownCoords: coords } : {}),
            ...(typeof event.zoneDescription === 'string' && event.zoneDescription
              ? { zoneHint: event.zoneDescription }
              : {}),
          });
        } finally {
          // Resolve waiters either way so queued LOCATION_UPDATEs don't hang.
          if (localId) {
            if (r?.id) rememberServerIncidentId(localId, r.id);
            else deferredFor(localId).resolve(null);
          }
        }
        if (r?.id) markDispatched(r.id);
        return;
      }
      case 'LOCATION_UPDATE': {
        const coords = coerceCoords(event.coords);
        if (!coords || typeof event.incidentId !== 'string') return;
        const serverId = await serverIncidentIdFor(event.incidentId);
        if (!serverId) return;
        await postIncidentLocation(serverId, coords);
        return;
      }
      case 'BEACON_RESET': {
        const studentId = typeof event.studentId === 'string' ? event.studentId : '';
        if (!studentId) return;
        const localId = activeLocalIncidentByStudent.get(studentId) ?? latestActivationIdFor(studentId);
        activeLocalIncidentByStudent.delete(studentId);
        if (!localId) return;
        const serverId = await serverIncidentIdFor(localId);
        if (!serverId) return;
        markDispatched(`${serverId}:reset`);
        try {
          await postResetIncident(serverId);
        } finally {
          forgetIncident(localId);
        }
        return;
      }
      case 'CAMPUS_THREAT': {
        let r: { id: string } | null = null;
        if (event.status === 'active') r = await postDeclareThreat();
        else if (event.status === 'cleared') r = await postClearThreat();
        if (r?.id) markDispatched(r.id);
        return;
      }
      case 'CHAT_MESSAGE': {
        if (
          typeof event.studentId !== 'string' ||
          typeof event.message !== 'string' ||
          !event.message.trim()
        ) return;
        const r = await postChatMessage({
          studentUserId: event.studentId,
          body: event.message,
        });
        if (r?.id) markDispatched(r.id);
        return;
      }
      case 'MASS_BROADCAST': {
        if (typeof event.message !== 'string' || !event.message.trim()) return;
        const aud = (event.audience ?? 'everyone') as V1Audience;
        const r = await postMassMessage({
          audience: normalizeAudience(aud),
          body: event.message,
        });
        if (r?.id) markDispatched(r.id);
        return;
      }
      case 'STAFF_BROADCAST': {
        if (
          typeof event.studentId !== 'string' ||
          typeof event.message !== 'string' ||
          !event.message.trim()
        ) return;
        // An all-clear ends the student's incident locally (deriveActiveIncidents);
        // mirror that on the server so the row doesn't stay 'active' forever.
        if (event.kind === 'all_clear') {
          const activationId = latestActivationIdFor(event.studentId);
          if (activationId) {
            const serverId = await serverIncidentIdFor(activationId);
            if (serverId) {
              markDispatched(`${serverId}:reset`);
              await postClearIncident(serverId).catch(() => undefined);
            }
          }
        }
        const r = await postStaffBroadcast({
          studentUserId: event.studentId,
          body: event.message,
        });
        if (r?.id) markDispatched(r.id);
        return;
      }
      // INCIDENT_NOTE: still local-only — no server analogue yet.
      default:
        return;
    }
  } catch (err) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[events] server dispatch failed:', err instanceof Error ? err.message : String(err));
    }
  }
}

export async function clearEvents(): Promise<void> {
  await hydrate();
  store.events = [];
  await persist();
  notify();
}
