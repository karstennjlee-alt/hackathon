// Local event log — primary read path is AsyncStorage so the v1 monolith
// stays snappy and demo mode keeps working without auth. When the user is
// signed in with a real campus_id claim, every appendEvent ALSO fires a
// background dispatch to the v2 server (best-effort, never blocks the UI
// and never throws). That lights up the audit log + admin console reads
// today; Supabase Realtime cross-device sync is step 7c2.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../supabase';
import {
  postActivateIncident,
  postChatMessage,
  postClearThreat,
  postDeclareThreat,
  postMassMessage,
} from './server';

const EVENTS_KEY = 'beacon5.events.v1';
const MAX_EVENTS = 500;

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
  store.hydrating = (async () => {
    try {
      const raw = await AsyncStorage.getItem(EVENTS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) store.events = parsed;
      }
    } catch {
      // corrupted store — start fresh
    }
    store.hydrated = true;
  })();
  return store.hydrating;
}

async function persist(): Promise<void> {
  try {
    const trimmed = store.events.slice(-MAX_EVENTS);
    if (trimmed.length === 0) {
      await AsyncStorage.removeItem(EVENTS_KEY);
    } else {
      await AsyncStorage.setItem(EVENTS_KEY, JSON.stringify(trimmed));
    }
  } catch {
    // best effort
  }
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
  hydrate().then(() => {
    onEvents(store.events as E[]);
  });
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
        await postActivateIncident({
          ...(coords ? { lastKnownCoords: coords } : {}),
          ...(typeof event.zoneDescription === 'string' && event.zoneDescription
            ? { zoneHint: event.zoneDescription }
            : {}),
        });
        return;
      }
      case 'CAMPUS_THREAT': {
        if (event.status === 'active') await postDeclareThreat();
        else if (event.status === 'cleared') await postClearThreat();
        return;
      }
      case 'CHAT_MESSAGE': {
        if (
          typeof event.studentId !== 'string' ||
          typeof event.message !== 'string' ||
          !event.message.trim()
        ) return;
        await postChatMessage({
          studentUserId: event.studentId,
          body: event.message,
        });
        return;
      }
      case 'MASS_BROADCAST': {
        if (typeof event.message !== 'string' || !event.message.trim()) return;
        const aud = (event.audience ?? 'everyone') as V1Audience;
        await postMassMessage({
          audience: normalizeAudience(aud),
          body: event.message,
        });
        return;
      }
      // BEACON_RESET, INCIDENT_NOTE, LOCATION_UPDATE, STAFF_BROADCAST:
      // no direct server route in 7c1 — the local log is enough for the
      // monolith. LOCATION_UPDATE + STAFF_BROADCAST require server
      // incident-id lookup that lands in 7c2.
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
