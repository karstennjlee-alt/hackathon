// AI client — calls the Beacon5 server's /v1/ai/* endpoints with the
// signed-in user's Supabase JWT. The server holds the Gemini API key.
// Closes G2 — the client bundle no longer ships an EXPO_PUBLIC_GEMINI_API_KEY.
//
// Every function returns a string OR null on hard failure. The v1 monolith
// already has deterministic fallback text at each call-site, so a null
// response degrades the UX exactly the way it did when callGemini failed.

import { supabase } from '../supabase';
import { env } from '../env';

interface AiResponse {
  text: string;
  source: 'primary' | 'fallback' | 'template';
  model?: string;
}

async function authHeader(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  return `Bearer ${token}`;
}

async function post(
  path: '/v1/ai/clarify-alert' | '/v1/ai/brief' | '/v1/ai/all-clear' | '/v1/ai/polish-broadcast',
  body: unknown,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const auth = await authHeader();
    if (!auth) return null;
    const res = await fetch(`${env.EXPO_PUBLIC_API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: auth },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as AiResponse;
    return typeof json.text === 'string' && json.text.length > 0 ? json.text : null;
  } catch {
    return null;
  }
}

export function aiClarifyAlert(
  input: { studentLabel: string; locationHint?: string; context?: string },
  signal?: AbortSignal,
): Promise<string | null> {
  return post('/v1/ai/clarify-alert', input, signal);
}

export function aiBrief(
  input: {
    incidentType: string;
    campusName: string;
    location?: string;
    staffOnScene?: number;
    studentsAffected?: number;
  },
  signal?: AbortSignal,
): Promise<string | null> {
  return post('/v1/ai/brief', input, signal);
}

export function aiAllClear(
  input: { campusName: string; durationMin?: number },
  signal?: AbortSignal,
): Promise<string | null> {
  return post('/v1/ai/all-clear', input, signal);
}

export function aiPolishBroadcast(
  input: { draft: string; audience: 'students' | 'parents' | 'staff' | 'everyone' },
  signal?: AbortSignal,
): Promise<string | null> {
  return post('/v1/ai/polish-broadcast', input, signal);
}
