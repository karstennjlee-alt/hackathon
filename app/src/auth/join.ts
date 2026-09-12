// Campus membership — redeem a join code or bootstrap a brand-new campus.
// Both hit the v2 server with the signed-in user's Supabase JWT and, on
// success, the caller must refresh the session so the new campus_id/role
// claims land in the JWT (RLS reads them).

import { supabase } from '../supabase';
import { env } from '../env';

export class JoinError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new JoinError('AUTH_REQUIRED', 'Sign in first');
  const res = await fetch(`${env.EXPO_PUBLIC_API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as ApiErrorBody;
    throw new JoinError(json.error?.code ?? `HTTP_${res.status}`, json.error?.message ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export interface MembershipResult {
  uid: string;
  campusId: string;
  campusName: string;
  role: 'student' | 'parent' | 'staff' | 'admin';
  displayName: string;
}

export function redeemJoinCode(code: string, displayName: string): Promise<MembershipResult> {
  return post('/v1/auth/join', { code: code.trim(), displayName: displayName.trim() });
}

export function bootstrapCampus(input: {
  orgName: string;
  campusName: string;
  displayName: string;
}): Promise<MembershipResult> {
  return post('/v1/auth/bootstrap', {
    orgName: input.orgName.trim(),
    campusName: input.campusName.trim(),
    displayName: input.displayName.trim(),
  });
}

// ─── staff / admin management calls ──────────────────────────────

export type CodeRole = 'student' | 'staff' | 'admin' | 'parent';

export function issueJoinCode(
  role: CodeRole,
  opts: { studentUserId?: string; expiresInHours?: number } = {},
): Promise<{ code: string; role: CodeRole; studentUserId?: string; expiresAt: number }> {
  return post('/v1/auth/join-codes', { role, ...opts });
}

export interface ProvisionResult {
  studentId: string;
  status: 'created' | 'exists' | 'error';
  pin?: string;
  error?: string;
}

export function provisionStudents(
  students: Array<{ studentId: string; displayName: string; pin?: string }>,
): Promise<{ results: ProvisionResult[] }> {
  return post('/v1/roster/students', { students });
}

export function rotateStudentPin(studentId: string, pin?: string): Promise<{ studentId: string; pin?: string }> {
  return post(`/v1/roster/students/${encodeURIComponent(studentId)}/pin`, pin ? { pin } : {});
}

// Friendly copy for the codes the server can return.
export function describeJoinError(err: unknown): string {
  if (!(err instanceof JoinError)) return err instanceof Error ? err.message : 'Something went wrong';
  switch (err.code) {
    case 'CODE_INVALID': return 'That code doesn’t match any campus. Check it and try again.';
    case 'CODE_USED': return 'That code has already been used. Ask your school for a new one.';
    case 'CODE_EXPIRED': return 'That code has expired. Ask your school for a new one.';
    case 'ALREADY_MEMBER': return 'This account already belongs to a campus.';
    case 'VALIDATION':
    case 'BAD_REQUEST': return err.message;
    case 'AUTH_REQUIRED': return 'Your session expired. Sign in again.';
    default: return `${err.message} (${err.code})`;
  }
}
