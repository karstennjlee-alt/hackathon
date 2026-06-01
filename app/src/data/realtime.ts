// Supabase Realtime → BeaconEvent bridge.
//
// When the signed-in user has a campus_id claim, we open postgres_changes
// channels on the 4 live-update tables filtered by campus_id and convert
// each INSERT into a v1-shaped BeaconEvent so the monolith's existing
// renderers light up with cross-device data.
//
// Dedupe against this device's own writes runs inside events.ts —
// dispatchToServer records the server-side id via markDispatched(id),
// and mergeRemoteEvent skips any id it's seen. The race is short
// because the realtime echo lands within a couple seconds.

import { supabase } from '../supabase';
import { mergeRemoteEvent } from './events';
import { lookupUserName, hydrateCampusRoster, clearUserCache } from './users';

interface DbCoords { lat?: number; lng?: number; accuracy?: number | null }
interface V1Coords { latitude: number; longitude: number; accuracy: number | null }

function toV1Coords(c: unknown): V1Coords | null {
  if (!c || typeof c !== 'object') return null;
  const o = c as DbCoords;
  if (typeof o.lat !== 'number' || typeof o.lng !== 'number') return null;
  return {
    latitude: o.lat,
    longitude: o.lng,
    accuracy: typeof o.accuracy === 'number' ? o.accuracy : null,
  };
}

function toMs(ts: unknown): number {
  if (typeof ts === 'string') {
    const ms = Date.parse(ts);
    return Number.isFinite(ms) ? ms : Date.now();
  }
  if (typeof ts === 'number') return ts;
  return Date.now();
}

// ─── row → BeaconEvent transformers ───────────────────────────────

interface IncidentRow {
  id: string;
  campus_id: string;
  student_user_id: string;
  status: 'active' | 'cleared' | 'reset';
  activated_at: string;
  last_known_coords?: unknown;
  zone_hint?: string | null;
}

async function fromIncident(row: IncidentRow): Promise<unknown | null> {
  if (row.status !== 'active') return null;
  const studentName = await lookupUserName(row.student_user_id);
  return {
    type: 'BEACON_ACTIVATED',
    id: row.id,
    studentId: row.student_user_id,
    studentName,
    coords: toV1Coords(row.last_known_coords),
    zoneDescription: row.zone_hint ?? undefined,
    at: toMs(row.activated_at),
  };
}

interface ThreatRow {
  id: string;
  campus_id: string;
  status: 'active' | 'cleared';
  actor_user_id: string;
  at: string;
}

async function fromThreat(row: ThreatRow): Promise<unknown> {
  const actorName = await lookupUserName(row.actor_user_id);
  return {
    type: 'CAMPUS_THREAT',
    id: row.id,
    status: row.status,
    actorName,
    at: toMs(row.at),
  };
}

interface MessageRow {
  id: string;
  campus_id: string;
  kind: 'chat' | 'broadcast' | 'mass';
  sender_user_id: string;
  sender_role: 'student' | 'parent' | 'staff' | 'admin';
  audience?: string[] | null;
  student_user_id?: string | null;
  body: string;
  clarified_body?: string | null;
  at: string;
}

async function fromMessage(row: MessageRow): Promise<unknown | null> {
  const senderName = await lookupUserName(row.sender_user_id);
  const at = toMs(row.at);

  if (row.kind === 'chat') {
    if (!row.student_user_id) return null;
    const sender: 'staff' | 'parent' =
      row.sender_role === 'parent' ? 'parent' : 'staff';
    return {
      type: 'CHAT_MESSAGE',
      id: row.id,
      sender,
      senderName,
      studentId: row.student_user_id,
      message: row.body,
      at,
    };
  }
  if (row.kind === 'broadcast') {
    if (!row.student_user_id) return null;
    return {
      type: 'STAFF_BROADCAST',
      id: row.id,
      studentId: row.student_user_id,
      message: row.body,
      // The v2 schema doesn't yet distinguish all_clear vs update. The
      // monolith's render path treats either tag the same when there's
      // no active incident — we lean to "update" to be safe.
      kind: 'update',
      at,
    };
  }
  // mass
  const audience: 'students' | 'parents' | 'teachers' | 'everyone' | 'both' = (() => {
    const a = row.audience ?? [];
    if (a.includes('everyone')) return 'everyone';
    const hasS = a.includes('students');
    const hasP = a.includes('parents');
    if (hasS && hasP) return 'both';
    if (hasS) return 'students';
    if (hasP) return 'parents';
    if (a.includes('teachers')) return 'teachers';
    return 'everyone';
  })();
  return {
    type: 'MASS_BROADCAST',
    id: row.id,
    senderId: row.sender_user_id,
    senderName,
    audience,
    message: row.body,
    at,
  };
}

interface LocationRow {
  id: string;
  campus_id: string;
  incident_id: string;
  student_user_id: string;
  coords: unknown;
  at: string;
}

async function fromLocation(row: LocationRow): Promise<unknown | null> {
  const coords = toV1Coords(row.coords);
  if (!coords) return null;
  return {
    type: 'LOCATION_UPDATE',
    id: row.id,
    studentId: row.student_user_id,
    incidentId: row.incident_id,
    coords,
    at: toMs(row.at),
  };
}

// ─── channel lifecycle ────────────────────────────────────────────

let activeCampusId: string | null = null;
let channels: Array<{ unsubscribe: () => Promise<'ok' | 'timed out' | 'error'> }> = [];

type RealtimePayload<T> = { new: T };

async function safeMerge(event: unknown | null): Promise<void> {
  if (!event) return;
  try {
    await mergeRemoteEvent(event as { id: string });
  } catch {
    // never throw inside the realtime callback
  }
}

export async function startRealtimeSync(campusId: string): Promise<void> {
  if (activeCampusId === campusId && channels.length > 0) return; // already running
  await stopRealtimeSync();
  activeCampusId = campusId;
  await hydrateCampusRoster(campusId);

  const filter = `campus_id=eq.${campusId}`;
  const tables: Array<{
    table: 'incidents' | 'campus_threats' | 'messages' | 'location_points';
    transform: (row: unknown) => Promise<unknown | null> | unknown | null;
  }> = [
    { table: 'incidents',       transform: (r) => fromIncident(r as IncidentRow) },
    { table: 'campus_threats',  transform: (r) => fromThreat(r as ThreatRow) },
    { table: 'messages',        transform: (r) => fromMessage(r as MessageRow) },
    { table: 'location_points', transform: (r) => fromLocation(r as LocationRow) },
  ];

  for (const { table, transform } of tables) {
    const ch = supabase
      .channel(`beacon5:${table}:${campusId}`)
      .on(
        'postgres_changes' as never,
        { event: 'INSERT', schema: 'public', table, filter } as never,
        (payload: RealtimePayload<unknown>) => {
          void Promise.resolve(transform(payload.new)).then(safeMerge);
        },
      )
      .subscribe();
    channels.push(ch as unknown as { unsubscribe: () => Promise<'ok' | 'timed out' | 'error'> });
  }
}

export async function stopRealtimeSync(): Promise<void> {
  const old = channels;
  channels = [];
  activeCampusId = null;
  await Promise.allSettled(old.map((c) => c.unsubscribe().catch(() => undefined)));
  clearUserCache();
}
