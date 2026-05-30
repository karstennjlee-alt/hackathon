// POST /v1/auth/bootstrap
// One-time only — the first authed user creates the first Organization +
// Campus and becomes its first admin. Refuses once any Organization exists.
//
// This is the only path to create the first admin without a join code.
// All subsequent users come in via /v1/auth/join.

import type { Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { db } from '../firebase';
import { setSessionClaims } from './claims';
import { ApiError } from '../http';
import type { Auth, User, Campus, Organization, CampusPolicy, CampusBranding } from '@beacon5/shared';

const Body = z.object({
  orgName: z.string().min(1).max(120),
  campusName: z.string().min(1).max(120),
  displayName: z.string().min(1).max(60),
});

const DEFAULT_POLICY: CampusPolicy = {
  whoCanDeclareThreat: 'any-staff',         // DECISIONS.md D4
  locationPolicy: 'on-activation',          // DECISIONS.md D3
  defaultAudiences: ['students', 'parents', 'teachers'],
  retentionDays: 90,
  languages: ['en'],
  allow911Mention: false,                   // PRD §8.10.5 default
  studentProvisioning: 'school',            // DECISIONS.md D2
};

function id(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

export async function postBootstrap(req: Request, res: Response): Promise<void> {
  const decoded = req.firebaseUser;
  if (!decoded) throw new ApiError(401, 'AUTH_REQUIRED', 'No verified token');

  const parsed = Body.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(400, 'BAD_REQUEST', parsed.error.errors[0]?.message ?? 'invalid body');
  }

  // Reject if any organization already exists.
  const existingOrgs = await db.collection('organizations').limit(1).get();
  if (!existingOrgs.empty) {
    throw new ApiError(403, 'BOOTSTRAP_CLOSED', 'Bootstrap already completed — request a join code from an admin');
  }

  // Reject if the caller is already in some campus (defensive).
  const existingMember = await db.collectionGroup('users').where('id', '==', decoded.uid).limit(1).get();
  if (!existingMember.empty) {
    throw new ApiError(409, 'ALREADY_MEMBER', 'This account is already a campus member');
  }

  const now = Date.now();
  const orgId = id('org');
  const campusId = id('cmp');

  const org: Organization = {
    id: orgId,
    name: parsed.data.orgName,
    type: 'school',
    createdAt: now,
  };

  const branding: CampusBranding = { displayName: parsed.data.campusName };

  const campus: Campus = {
    id: campusId,
    orgId,
    name: parsed.data.campusName,
    branding,
    policy: DEFAULT_POLICY,
    createdAt: now,
  };

  const adminUser: User = {
    id: decoded.uid,
    campusId,
    role: 'admin',
    displayName: parsed.data.displayName,
    isMinor: false,
    authProviderId: decoded.firebase?.sign_in_provider ?? 'unknown',
    createdAt: now,
  };

  const batch = db.batch();
  batch.set(db.collection('organizations').doc(orgId), org);
  batch.set(db.collection('campuses').doc(campusId), campus);
  batch.set(db.collection('campuses').doc(campusId).collection('users').doc(decoded.uid), adminUser);
  await batch.commit();

  await setSessionClaims(decoded.uid, { campusId, role: 'admin' });

  const body: Auth.BootstrapResponse = {
    uid: adminUser.id,
    campusId,
    role: 'admin',
    displayName: adminUser.displayName,
    isMinor: false,
  };
  res.status(201).json(body);
}
