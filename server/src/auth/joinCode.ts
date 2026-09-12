// POST /v1/auth/join — redeem a one-time join code.
// POST /v1/auth/join-codes — admin/staff issues a code.

import type { Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { admin } from '../supabase';
import { setSessionClaims } from './claims';
import { ApiError } from '../http';
import type { Auth } from '@beacon5/shared';

const RedeemBody = z.object({
  code: z.string().min(4).max(40),
  displayName: z.string().min(1).max(60),
});

interface JoinCodeRow {
  code: string;
  campus_id: string;
  role: 'student' | 'staff' | 'admin' | 'parent';
  student_user_id: string | null;   // set for parent (guardian) codes
  expires_at: string;
  consumed_by: string | null;
}

export async function postJoin(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'No verified token');
  const uid = req.user.sub;

  const parsed = RedeemBody.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(400, 'BAD_REQUEST', parsed.error.errors[0]?.message ?? 'invalid body');
  }
  const { code, displayName } = parsed.data;
  const normalized = code.replace(/\s+/g, '').toUpperCase();

  // Atomic redeem: claim the code only if still unconsumed + not expired.
  const nowIso = new Date().toISOString();
  const { data: claimed, error: claimErr } = await admin
    .from('join_codes')
    .update({ consumed_by: uid, consumed_at: nowIso })
    .eq('code', normalized)
    .is('consumed_by', null)
    .gt('expires_at', nowIso)
    .select('code, campus_id, role, student_user_id, expires_at, consumed_by')
    .maybeSingle();

  if (claimErr) throw new Error(`join_codes claim: ${claimErr.message}`);
  if (!claimed) {
    // Distinguish "not found" vs "used/expired" with one extra read.
    const { data: existing } = await admin
      .from('join_codes')
      .select('consumed_by, expires_at')
      .eq('code', normalized)
      .maybeSingle();
    if (!existing) throw new ApiError(404, 'CODE_INVALID', 'Join code not found');
    if (existing.consumed_by) throw new ApiError(410, 'CODE_USED', 'Join code already redeemed');
    throw new ApiError(410, 'CODE_EXPIRED', 'Join code has expired');
  }

  const row = claimed as JoinCodeRow;

  // Already a member somewhere? Roll back the redeem.
  const { data: existingUser } = await admin
    .from('users')
    .select('id')
    .eq('id', uid)
    .maybeSingle();
  if (existingUser) {
    await admin.from('join_codes').update({ consumed_by: null, consumed_at: null }).eq('code', normalized);
    throw new ApiError(409, 'ALREADY_MEMBER', 'This account is already a campus member');
  }

  const provider = req.user.app_metadata?.provider ?? 'unknown';
  const { error: insertErr } = await admin.from('users').insert({
    id: uid,
    campus_id: row.campus_id,
    role: row.role,
    display_name: displayName,
    is_minor: row.role === 'student',
    auth_provider: provider,
  });
  if (insertErr) {
    await admin.from('join_codes').update({ consumed_by: null, consumed_at: null }).eq('code', normalized);
    throw new Error(`users insert: ${insertErr.message}`);
  }

  // Guardian code: link the new parent to the student it was issued for.
  let linkedStudents: string[] | undefined;
  if (row.role === 'parent') {
    if (!row.student_user_id) throw new Error('parent join code has no student_user_id');
    const { error: linkErr } = await admin.from('guardian_links').insert({
      campus_id: row.campus_id,
      guardian_user_id: uid,
      student_user_id: row.student_user_id,
      verified: true,
    });
    if (linkErr) {
      await admin.from('users').delete().eq('id', uid);
      await admin.from('join_codes').update({ consumed_by: null, consumed_at: null }).eq('code', normalized);
      throw new Error(`guardian_links insert: ${linkErr.message}`);
    }
    linkedStudents = [row.student_user_id];
  }

  await setSessionClaims(uid, { campusId: row.campus_id, role: row.role });

  const { data: campus } = await admin
    .from('campuses')
    .select('name, branding, code')
    .eq('id', row.campus_id)
    .maybeSingle();
  const branding = (campus?.branding ?? {}) as { displayName?: string };

  const body: Auth.JoinResponse = {
    uid,
    campusId: row.campus_id,
    campusName: branding.displayName || (campus?.name as string) || 'Campus',
    campusCode: (campus?.code as string) ?? '',
    role: row.role,
    displayName,
    isMinor: row.role === 'student',
    ...(linkedStudents ? { linkedStudents } : {}),
  };
  res.status(201).json(body);
}

// ──────────────────────────────────────────────────────────────────
// POST /v1/auth/join-codes  (staff/admin only)
// ──────────────────────────────────────────────────────────────────
const IssueBody = z
  .object({
    role: z.enum(['student', 'staff', 'admin', 'parent']),
    // Required for role='parent': the student this guardian will be linked to.
    studentUserId: z.string().uuid().optional(),
    expiresInHours: z.number().int().positive().max(720).optional(),
  })
  .refine((b) => b.role !== 'parent' || !!b.studentUserId, {
    message: 'studentUserId is required for a parent code',
    path: ['studentUserId'],
  });

function generateCode(): string {
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const raw = crypto.randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) out += ALPHABET[raw[i]! % ALPHABET.length];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

export async function postIssueJoinCode(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'No verified token');

  const parsed = IssueBody.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(400, 'BAD_REQUEST', parsed.error.errors[0]?.message ?? 'invalid body');
  }
  const callerCampus = req.user.app_metadata?.campus_id;
  const callerRole = req.user.app_metadata?.role;
  if (!callerCampus || !callerRole) {
    throw new ApiError(403, 'NOT_MEMBER', 'Caller is not a campus member');
  }
  if (callerRole !== 'staff' && callerRole !== 'admin') {
    throw new ApiError(403, 'FORBIDDEN', 'Only staff or admin can issue join codes');
  }
  if (parsed.data.role === 'admin' && callerRole !== 'admin') {
    throw new ApiError(403, 'FORBIDDEN', 'Only admin can issue admin codes');
  }

  // Parent codes must point at a student on the caller's campus.
  if (parsed.data.role === 'parent') {
    const { data: student, error: sErr } = await admin
      .from('users')
      .select('id, campus_id, role')
      .eq('id', parsed.data.studentUserId!)
      .maybeSingle();
    if (sErr) throw new Error(`users lookup: ${sErr.message}`);
    if (!student || student.campus_id !== callerCampus || student.role !== 'student') {
      throw new ApiError(404, 'NOT_FOUND', 'student not found on this campus', 'studentUserId');
    }
  }

  const expiresInHours = parsed.data.expiresInHours ?? 72;
  const expiresAt = new Date(Date.now() + expiresInHours * 3600 * 1000);
  const code = generateCode();

  const { error } = await admin.from('join_codes').insert({
    code,
    campus_id: callerCampus,
    role: parsed.data.role,
    student_user_id: parsed.data.role === 'parent' ? parsed.data.studentUserId : null,
    created_by: req.user.sub,
    expires_at: expiresAt.toISOString(),
  });
  if (error) throw new Error(`join_codes insert: ${error.message}`);

  const body: Auth.IssueJoinCodeResponse = {
    code,
    role: parsed.data.role,
    ...(parsed.data.role === 'parent' ? { studentUserId: parsed.data.studentUserId } : {}),
    expiresAt: expiresAt.getTime(),
  };
  res.status(201).json(body);
}
