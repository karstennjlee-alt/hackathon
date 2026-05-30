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
  role: 'student' | 'staff' | 'admin';
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
    .select('code, campus_id, role, expires_at, consumed_by')
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

  await setSessionClaims(uid, { campusId: row.campus_id, role: row.role });

  const body: Auth.JoinResponse = {
    uid,
    campusId: row.campus_id,
    role: row.role,
    displayName,
    isMinor: row.role === 'student',
  };
  res.status(201).json(body);
}

// ──────────────────────────────────────────────────────────────────
// POST /v1/auth/join-codes  (staff/admin only)
// ──────────────────────────────────────────────────────────────────
const IssueBody = z.object({
  role: z.enum(['student', 'staff', 'admin']),
  expiresInHours: z.number().int().positive().max(720).optional(),
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

  const expiresInHours = parsed.data.expiresInHours ?? 72;
  const expiresAt = new Date(Date.now() + expiresInHours * 3600 * 1000);
  const code = generateCode();

  const { error } = await admin.from('join_codes').insert({
    code,
    campus_id: callerCampus,
    role: parsed.data.role,
    created_by: req.user.sub,
    expires_at: expiresAt.toISOString(),
  });
  if (error) throw new Error(`join_codes insert: ${error.message}`);

  const body: Auth.IssueJoinCodeResponse = {
    code,
    role: parsed.data.role,
    expiresAt: expiresAt.getTime(),
  };
  res.status(201).json(body);
}
