// Helpers for reading + writing custom claims on Firebase auth tokens.
// Custom claims are the contract that Firestore + RTDB security rules read.
// See server/firestore-rules/README.md for the contract.

import { auth, db } from '../firebase';
import type { User } from '@beacon5/shared';

export interface UserClaims {
  campusId: string;
  role: User['role'];
  linkedStudents?: string[];
}

export async function setSessionClaims(uid: string, claims: UserClaims): Promise<void> {
  await auth.setCustomUserClaims(uid, {
    campusId: claims.campusId,
    role: claims.role,
    ...(claims.linkedStudents ? { linkedStudents: claims.linkedStudents } : {}),
  });
}

export async function loadUserRecord(campusId: string, uid: string): Promise<User | null> {
  const snap = await db.collection('campuses').doc(campusId).collection('users').doc(uid).get();
  if (!snap.exists) return null;
  return snap.data() as User;
}

// Finds the User across all campuses (used at /v1/auth/session when the client
// doesn't yet know which campus they're scoped to). One-campus-per-user is
// enforced by R8.1.2, so at most one match exists.
export async function findUserByUid(uid: string): Promise<{ campusId: string; user: User } | null> {
  const q = await db.collectionGroup('users').where('id', '==', uid).limit(1).get();
  if (q.empty) return null;
  const doc = q.docs[0]!;
  // path: campuses/{campusId}/users/{uid}
  const parts = doc.ref.path.split('/');
  const campusId = parts[1]!;
  return { campusId, user: doc.data() as User };
}

export async function linkedStudentIds(campusId: string, guardianUid: string): Promise<string[]> {
  const q = await db
    .collection('campuses')
    .doc(campusId)
    .collection('guardianLinks')
    .where('guardianUserId', '==', guardianUid)
    .where('verified', '==', true)
    .get();
  return q.docs.map((d) => (d.data() as { studentUserId: string }).studentUserId);
}
