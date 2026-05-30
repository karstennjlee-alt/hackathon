// POST /v1/auth/session
// Exchange a verified Supabase JWT for a server session.
// Idempotent: refreshes custom claims to match the current public.users row.
//
// If the caller has no public.users row yet, returns 404 NEEDS_JOIN — the
// client should redirect to a join-code or bootstrap flow.

import type { Request, Response } from 'express';
import { ApiError } from '../http';
import { findUserByUid, linkedStudentIds, setSessionClaims } from './claims';
import type { Auth } from '@beacon5/shared';

export async function postSession(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'No verified token');
  const uid = req.user.sub;

  const found = await findUserByUid(uid);
  if (!found) {
    throw new ApiError(
      404,
      'NEEDS_JOIN',
      'No campus membership for this account. Redeem a join code or bootstrap a new campus.',
    );
  }
  const { campusId, user } = found;

  let linked: string[] | undefined;
  if (user.role === 'parent') {
    linked = await linkedStudentIds(campusId, uid);
  }

  await setSessionClaims(uid, { campusId, role: user.role });

  const body: Auth.SessionResponse = {
    uid: user.id,
    campusId,
    role: user.role,
    displayName: user.display_name,
    isMinor: user.is_minor,
    ...(linked ? { linkedStudents: linked } : {}),
  };
  res.json(body);
}
