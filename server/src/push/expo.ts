// Server push via Expo's push service (R8.9). No SDK — the wire format is
// small and node 20's fetch is enough.
//
// Delivery model: the app fires LOCAL notifications for events it sees
// while running (v1 behaviour, unchanged). This module covers the case
// v1 couldn't: the app is backgrounded or killed. To avoid double alerts,
// every push carries data.remote=true and the app's notification handler
// suppresses remote alerts while it is in the foreground.
//
// Best-effort: a push failure never fails the request that triggered it.

import { admin } from '../supabase';
import { env } from '../env';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const CHUNK = 100;

export type PushKind = 'threat' | 'beacon' | 'broadcast' | 'mass' | 'chat';

export interface PushMessage {
  kind: PushKind;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

function isExpoToken(t: string): boolean {
  return /^Expo(nent)?PushToken\[.+\]$/.test(t);
}

// Time-sensitive breaks through Focus/DND on iOS (D5); 'emergency' is the
// high-importance Android channel the app creates at boot.
export function envelope(msg: PushMessage) {
  const urgent = msg.kind === 'threat' || msg.kind === 'beacon';
  return {
    title: msg.title,
    body: msg.body,
    sound: 'default',
    priority: 'high',
    channelId: urgent ? 'emergency' : 'updates',
    interruptionLevel: urgent ? 'time-sensitive' : 'active',
    data: { ...(msg.data ?? {}), kind: msg.kind, remote: true },
  };
}

export async function sendToTokens(tokens: string[], msg: PushMessage): Promise<void> {
  const valid = [...new Set(tokens.filter(isExpoToken))];
  if (valid.length === 0) return;
  const base = envelope(msg);
  for (let i = 0; i < valid.length; i += CHUNK) {
    const batch = valid.slice(i, i + CHUNK).map((to) => ({ to, ...base }));
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(env.EXPO_ACCESS_TOKEN ? { authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` } : {}),
        },
        body: JSON.stringify(batch),
      });
      if (!res.ok) {
        process.stderr.write(`[push] expo ${res.status}: ${(await res.text()).slice(0, 200)}\n`);
        continue;
      }
      const json = (await res.json()) as { data?: ExpoTicket[] };
      const dead: string[] = [];
      (json.data ?? []).forEach((t, idx) => {
        if (t.status === 'error' && t.details?.error === 'DeviceNotRegistered') dead.push(batch[idx]!.to);
      });
      if (dead.length) await admin.from('devices').delete().in('push_token', dead);
    } catch (err) {
      process.stderr.write(`[push] send failed: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
}

export async function sendToUsers(userIds: string[], msg: PushMessage): Promise<void> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return;
  const { data, error } = await admin.from('devices').select('push_token').in('user_id', ids);
  if (error) {
    process.stderr.write(`[push] devices lookup: ${error.message}\n`);
    return;
  }
  await sendToTokens((data ?? []).map((d) => d.push_token as string), msg);
}

// ─── audience resolvers ───────────────────────────────────────────

export async function campusUserIds(
  campusId: string,
  roles: Array<'student' | 'parent' | 'staff' | 'admin'>,
  except?: string,
): Promise<string[]> {
  const { data, error } = await admin.from('users').select('id').eq('campus_id', campusId).in('role', roles);
  if (error) {
    process.stderr.write(`[push] users lookup: ${error.message}\n`);
    return [];
  }
  return (data ?? []).map((u) => u.id as string).filter((id) => id !== except);
}

export async function guardianIds(campusId: string, studentUserId: string): Promise<string[]> {
  const { data } = await admin
    .from('guardian_links')
    .select('guardian_user_id')
    .eq('campus_id', campusId)
    .eq('student_user_id', studentUserId)
    .eq('verified', true);
  return (data ?? []).map((g) => g.guardian_user_id as string);
}

export type Audience = 'students' | 'parents' | 'teachers' | 'everyone';

export function audienceRoles(aud: Audience[]): Array<'student' | 'parent' | 'staff' | 'admin'> {
  const roles = new Set<'student' | 'parent' | 'staff' | 'admin'>();
  for (const a of aud) {
    if (a === 'everyone') return ['student', 'parent', 'staff', 'admin'];
    if (a === 'students') roles.add('student');
    if (a === 'parents') roles.add('parent');
    if (a === 'teachers') { roles.add('staff'); roles.add('admin'); }
  }
  return [...roles];
}

// Fire-and-forget wrapper: routes call this after responding.
export function pushLater(work: () => Promise<void>): void {
  void work().catch((err) => {
    process.stderr.write(`[push] ${err instanceof Error ? err.message : String(err)}\n`);
  });
}
