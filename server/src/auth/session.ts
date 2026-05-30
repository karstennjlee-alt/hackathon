// POST /v1/auth/session
// Exchange a verified Firebase ID token for a server session.
// Idempotent: refreshes custom claims to match the current User record.
//
// If the caller has no User record yet, returns 404 NEEDS_JOIN — the client
// should redirect to a join-code or bootstrap flow.

import type { Request, Response } from 'express';
import { ApiError } from '../http';
import { findUserByUid, linkedStudentIds, setSessionClaims } from './claims';
import type { Auth } from '@beacon5/shared';

export async function postSession(req: Request, res: Response): Promise<void> {
  const decoded = req.firebaseUser;
  if (!decoded) throw new ApiError(401, 'AUTH_REQUIRED', 'No verified token');

  const found = await findUserByUid(decoded.uid);
  if (!found) {
    throw new ApiError(
      404,
      'NEEDS_JOIN',
      'No campus membership for this account. Redeem a join code or bootstrap a new campus.',
    );
  }

  const { campusId, user } = found;

  // Recompute linkedStudents fresh for parents so claims stay in sync with the roster.
  let linked: string[] | undefined;
  if (user.role === 'parent') {
    linked = await linkedStudentIds(campusId, decoded.uid);
  }

  await setSessionClaims(decoded.uid, {
    campusId,
    role: user.role,
    linkedStudents: linked,
  });

  const body: Auth.SessionResponse = {
    uid: user.id,
    campusId,
    role: user.role,
    displayName: user.displayName,
    isMinor: user.isMinor,
    ...(linked ? { linkedStudents: linked } : {}),
  };
  res.json(body);
}
