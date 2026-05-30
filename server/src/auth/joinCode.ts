// POST /v1/auth/join — redeem a one-time join code.
// The code's role + campusId are authoritative; the caller cannot pick.
// On success, creates the User record and mints custom claims (R8.1.2).
//
// POST /v1/auth/join-codes — admin/staff issues a code for a given role.

import type { Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { db, FieldValue, Timestamp } from '../firebase';
import { setSessionClaims } from './claims';
import { ApiError } from '../http';
import type { Auth, User } from '@beacon5/shared';

const RedeemBody = z.object({
  code: z.string().min(4).max(40),
  displayName: z.string().min(1).max(60),
});

interface JoinCodeDoc {
  code: string;
  campusId: string;
  role: 'student' | 'staff' | 'admin';
  createdBy: string;
  createdAt: number;
  expiresAt: number;
  consumedBy?: string;
  consumedAt?: number;
}

export async function postJoin(req: Request, res: Response): Promise<void> {
  const decoded = req.firebaseUser;
  if (!decoded) throw new ApiError(401, 'AUTH_REQUIRED', 'No verified token');

  const parsed = RedeemBody.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(400, 'BAD_REQUEST', parsed.error.errors[0]?.message ?? 'invalid body');
  }
  const { code, displayName } = parsed.data;
  const normalized = code.replace(/\s+/g, '').toUpperCase();

  // Look up the code by collection-group query so we don't need to know the campusId.
  const codeQ = await db.collectionGroup('joinCodes').where('code', '==', normalized).limit(1).get();
  if (codeQ.empty) {
    throw new ApiError(404, 'CODE_INVALID', 'Join code not found');
  }
  const codeSnap = codeQ.docs[0]!;
  const codeData = codeSnap.data() as JoinCodeDoc;
  const now = Date.now();
  if (codeData.consumedBy) {
    throw new ApiError(410, 'CODE_USED', 'This join code has already been redeemed');
  }
  if (codeData.expiresAt < now) {
    throw new ApiError(410, 'CODE_EXPIRED', 'This join code has expired');
  }

  // Ensure the user doesn't already belong to a campus.
  const existing = await db.collectionGroup('users').where('id', '==', decoded.uid).limit(1).get();
  if (!existing.empty) {
    throw new ApiError(409, 'ALREADY_MEMBER', 'This account is already a member of a campus');
  }

  const campusId = codeData.campusId;
  const user: User = {
    id: decoded.uid,
    campusId,
    role: codeData.role,
    displayName,
    isMinor: codeData.role === 'student',
    authProviderId: decoded.firebase?.sign_in_provider ?? 'unknown',
    createdAt: now,
  };

  await db.runTransaction(async (tx) => {
    // Re-read inside the tx to defeat double-redeem races.
    const fresh = await tx.get(codeSnap.ref);
    const data = fresh.data() as JoinCodeDoc | undefined;
    if (!data) throw new ApiError(404, 'CODE_INVALID', 'Join code disappeared');
    if (data.consumedBy) throw new ApiError(410, 'CODE_USED', 'Already redeemed');
    if (data.expiresAt < Date.now()) throw new ApiError(410, 'CODE_EXPIRED', 'Expired');

    tx.set(db.collection('campuses').doc(campusId).collection('users').doc(decoded.uid), user);
    tx.update(codeSnap.ref, {
      consumedBy: decoded.uid,
      consumedAt: FieldValue.serverTimestamp(),
    });
  });

  await setSessionClaims(decoded.uid, { campusId, role: user.role });

  const body: Auth.JoinResponse = {
    uid: user.id,
    campusId,
    role: user.role,
    displayName: user.displayName,
    isMinor: user.isMinor,
  };
  res.status(201).json(body);
}

// ──────────────────────────────────────────────────────────────────
// POST /v1/auth/join-codes  (staff/admin only)
// Issues a new join code. Codes are short, human-typeable, and case-insensitive.
// ──────────────────────────────────────────────────────────────────

const IssueBody = z.object({
  role: z.enum(['student', 'staff', 'admin']),
  expiresInHours: z.number().int().positive().max(720).optional(),
});

function generateCode(): string {
  // 8 chars from a 32-letter base32-ish alphabet, grouped as XXXX-XXXX.
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
  const raw = crypto.randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) out += ALPHABET[raw[i]! % ALPHABET.length];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

export async function postIssueJoinCode(req: Request, res: Response): Promise<void> {
  const decoded = req.firebaseUser;
  if (!decoded) throw new ApiError(401, 'AUTH_REQUIRED', 'No verified token');

  const parsed = IssueBody.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(400, 'BAD_REQUEST', parsed.error.errors[0]?.message ?? 'invalid body');
  }

  const campusId = decoded.campusId as string | undefined;
  const callerRole = decoded.role as string | undefined;
  if (!campusId || !callerRole) {
    throw new ApiError(403, 'NOT_MEMBER', 'Caller is not a campus member');
  }
  if (callerRole !== 'staff' && callerRole !== 'admin') {
    throw new ApiError(403, 'FORBIDDEN', 'Only staff or admin can issue join codes');
  }
  if (parsed.data.role === 'admin' && callerRole !== 'admin') {
    throw new ApiError(403, 'FORBIDDEN', 'Only admin can issue admin codes');
  }

  const expiresInHours = parsed.data.expiresInHours ?? 72;
  const now = Date.now();
  const expiresAt = now + expiresInHours * 3600 * 1000;
  const code = generateCode();

  const doc: JoinCodeDoc = {
    code,
    campusId,
    role: parsed.data.role,
    createdBy: decoded.uid,
    createdAt: now,
    expiresAt,
  };

  await db
    .collection('campuses')
    .doc(campusId)
    .collection('joinCodes')
    .doc(code)
    .set(doc);

  const body: Auth.IssueJoinCodeResponse = { code, role: parsed.data.role, expiresAt };
  res.status(201).json(body);
}
