// Local event log — single-device demo store backed by AsyncStorage.
//
// This is the storage layer behind the v1 monolith's BeaconEvent log.
// Firebase RTDB (the cross-device sync the hackathon demo used) is gone;
// real cross-device sync now lives behind the v2 server's /v1/incidents,
// /v1/threat, and /v1/messages routes, which write to Supabase and stream
// updates via Supabase Realtime. That wiring lands in step 7c.
//
// For now this module preserves the existing in-process API
// (subscribeToEvents / appendEvent / clearEvents) so the v1 monolith
// keeps working unchanged in demo mode.

import AsyncStorage from '@react-native-async-storage/async-storage';

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
}

export async function clearEvents(): Promise<void> {
  await hydrate();
  store.events = [];
  await persist();
  notify();
}
