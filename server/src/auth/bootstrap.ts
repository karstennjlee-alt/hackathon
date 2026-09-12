// POST /v1/auth/bootstrap — self-serve campus creation (DECISIONS.md D1).
// Any signed-in account that isn't yet a campus member may create an
// Organization + Campus and becomes its first admin. Membership is still
// one-campus-per-account (R8.1.2), so an existing member is refused.

import type { Request, Response } from 'express';
import { z } from 'zod';
import { admin } from '../supabase';
import { setSessionClaims } from './claims';
import { ApiError } from '../http';
import type { Auth } from '@beacon5/shared';

const Body = z.object({
  orgName: z.string().min(1).max(120),
  campusName: z.string().min(1).max(120),
  displayName: z.string().min(1).max(60),
});

export async function postBootstrap(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'No verified token');
  const uid = req.user.sub;

  const parsed = Body.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(400, 'BAD_REQUEST', parsed.error.errors[0]?.message ?? 'invalid body');
  }

  // Reject if caller is already in some campus.
  const { data: existingUser } = await admin.from('users').select('id').eq('id', uid).maybeSingle();
  if (existingUser) {
    throw new ApiError(409, 'ALREADY_MEMBER', 'This account is already a campus member');
  }

  // Insert org → campus → admin user. Defaults from DECISIONS.md baked into 001_init.sql.
  const { data: org, error: orgInsErr } = await admin
    .from('organizations')
    .insert({ name: parsed.data.orgName, type: 'school' })
    .select('id')
    .single();
  if (orgInsErr) throw new Error(`organizations insert: ${orgInsErr.message}`);

  const { data: campus, error: campusInsErr } = await admin
    .from('campuses')
    .insert({
      org_id: org.id,
      name: parsed.data.campusName,
      branding: { displayName: parsed.data.campusName },
    })
    .select('id')
    .single();
  if (campusInsErr) throw new Error(`campuses insert: ${campusInsErr.message}`);

  const provider = req.user.app_metadata?.provider ?? 'unknown';
  const { error: userInsErr } = await admin.from('users').insert({
    id: uid,
    campus_id: campus.id,
    role: 'admin',
    display_name: parsed.data.displayName,
    is_minor: false,
    auth_provider: provider,
  });
  if (userInsErr) throw new Error(`users insert: ${userInsErr.message}`);

  await setSessionClaims(uid, { campusId: campus.id as string, role: 'admin' });

  const body: Auth.BootstrapResponse = {
    uid,
    campusId: campus.id as string,
    campusName: parsed.data.campusName,
    role: 'admin',
    displayName: parsed.data.displayName,
    isMinor: false,
  };
  res.status(201).json(body);
}
