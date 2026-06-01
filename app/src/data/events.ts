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
  postClearThreat,
  postDeclareThreat,
  postMassMessage,
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
  store.events = [];
  store.hydrated = false;
  store.hydrating = null;
  notify();
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
        const coords = coerceCoords(event.coords);
        const r = await postActivateIncident({
          ...(coords ? { lastKnownCoords: coords } : {}),
          ...(typeof event.zoneDescription === 'string' && event.zoneDescription
            ? { zoneHint: event.zoneDescription }
            : {}),
        });
        if (r?.id) markDispatched(r.id);
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
        const r = await postStaffBroadcast({
          studentUserId: event.studentId,
          body: event.message,
        });
        if (r?.id) markDispatched(r.id);
        return;
      }
      // BEACON_RESET, INCIDENT_NOTE, LOCATION_UPDATE: still local-only.
      // LOCATION_UPDATE needs the server incident-id mapping that we don't
      // track yet; BEACON_RESET + INCIDENT_NOTE have no server analogue.
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
