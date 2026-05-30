// Read + write of Beacon5 custom claims on Supabase auth users.
// Claims live in auth.users.raw_app_meta_data; updated via Admin SDK.
// Schema:  { campus_id: string, role: Role, provider?: string }

import { admin } from '../supabase';
import type { Role } from '@beacon5/shared';

export interface UserClaims {
  campusId: string;
  role: Role;
}

// Merges the Beacon5 keys into existing app_metadata (preserving provider/providers).
export async function setSessionClaims(uid: string, claims: UserClaims): Promise<void> {
  const { data, error: getErr } = await admin.auth.admin.getUserById(uid);
  if (getErr) throw new Error(`getUserById(${uid}): ${getErr.message}`);
  const current = (data.user?.app_metadata ?? {}) as Record<string, unknown>;
  const next = {
    ...current,
    campus_id: claims.campusId,
    role: claims.role,
  };
  const { error } = await admin.auth.admin.updateUserById(uid, { app_metadata: next });
  if (error) throw new Error(`updateUserById(${uid}): ${error.message}`);
}

// Find the (at most one) campus + user record for an auth uid.
export async function findUserByUid(
  uid: string,
): Promise<{ campusId: string; user: UserRow } | null> {
  const { data, error } = await admin
    .from('users')
    .select('id, campus_id, role, display_name, is_minor, auth_provider, created_at')
    .eq('id', uid)
    .maybeSingle();
  if (error) throw new Error(`findUserByUid: ${error.message}`);
  if (!data) return null;
  return {
    campusId: data.campus_id as string,
    user: data as UserRow,
  };
}

export async function linkedStudentIds(
  campusId: string,
  guardianUid: string,
): Promise<string[]> {
  const { data, error } = await admin
    .from('guardian_links')
    .select('student_user_id')
    .eq('campus_id', campusId)
    .eq('guardian_user_id', guardianUid)
    .eq('verified', true);
  if (error) throw new Error(`linkedStudentIds: ${error.message}`);
  return (data ?? []).map((r) => r.student_user_id as string);
}

// Public users table row shape (snake_case as stored).
export interface UserRow {
  id: string;
  campus_id: string;
  role: Role;
  display_name: string;
  is_minor: boolean;
  auth_provider: string | null;
  created_at: string;
}
