// Thin client for the v2 server's mutation endpoints.
// Each function returns the parsed body on success or throws on error.
// All routes require a Supabase Bearer JWT — see authHeader().
//
// These are deliberately permissive: a request that fires while the
// session is mid-refresh (no token) is treated as "skip" rather than an
// error, so the v1 monolith's fire-and-forget dispatch flow never
// blocks the UI on a transient auth blip.

import { supabase } from '../supabase';
import { env } from '../env';

async function authHeader(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? `Bearer ${token}` : null;
}

async function post<T>(path: string, body: unknown): Promise<T | null> {
  const auth = await authHeader();
  if (!auth) return null;
  const res = await fetch(`${env.EXPO_PUBLIC_API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: auth },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${path} ${res.status}: ${text.slice(0, 240)}`);
  }
  return (await res.json()) as T;
}

// ─── incidents ────────────────────────────────────────────────────
export function postActivateIncident(input: {
  escalation?: {
    kind?: 'threat' | 'medical' | 'unspecified';
    presets?: string[];
    rawNote?: string;
    clarifiedNote?: string;
  };
  lastKnownCoords?: { lat: number; lng: number; accuracy?: number };
  zoneHint?: string;
}): Promise<{ id: string; activatedAt?: number; alreadyActive?: boolean } | null> {
  return post('/v1/incidents', input);
}

// ─── threat ───────────────────────────────────────────────────────
export function postDeclareThreat(): Promise<{ id: string; status: 'active'; at: number } | null> {
  return post('/v1/threat/declare', {});
}

export function postClearThreat(): Promise<{ id: string; status: 'cleared'; at: number } | null> {
  return post('/v1/threat/clear', {});
}

// ─── messages ─────────────────────────────────────────────────────
export function postChatMessage(input: {
  studentUserId: string;
  body: string;
  clarifiedBody?: string;
}): Promise<{ id: string; at: number } | null> {
  return post('/v1/messages/chat', input);
}

export function postMassMessage(input: {
  audience: Array<'students' | 'parents' | 'teachers' | 'everyone'>;
  body: string;
  clarifiedBody?: string;
}): Promise<{ id: string; at: number } | null> {
  return post('/v1/messages/mass', input);
}

export function postStaffBroadcast(input: {
  studentUserId: string;
  body: string;
  clarifiedBody?: string;
}): Promise<{ id: string; at: number } | null> {
  return post('/v1/messages/broadcast', input);
}
