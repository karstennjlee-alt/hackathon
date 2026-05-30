// Express middleware that gates a route on a specific permission from §8.2.2.
// Must run AFTER verifyToken — relies on req.firebaseUser custom claims.

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { Role } from '@beacon5/shared';
import { hasPermission, requiresStepUp, type Permission } from './permissions';
import { ApiError } from '../http';

function callerRole(req: Request): Role | null {
  const r = req.firebaseUser?.role;
  if (r === 'student' || r === 'parent' || r === 'staff' || r === 'admin') return r;
  return null;
}

export function requirePermission(perm: Permission): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.firebaseUser) return next(new ApiError(401, 'AUTH_REQUIRED', 'no verified token'));
    const role = callerRole(req);
    if (!role) return next(new ApiError(403, 'NOT_MEMBER', 'caller has no campus role'));
    if (!hasPermission(role, perm)) {
      return next(new ApiError(403, 'FORBIDDEN', `role ${role} lacks permission ${perm}`));
    }
    if (requiresStepUp(perm)) {
      // PRD R8.2.3 — step-up auth. We require auth_time within the last 5 minutes
      // as a proxy for "recent re-auth." Firebase ID tokens carry auth_time.
      const authTime = req.firebaseUser.auth_time as number | undefined;
      const ageSec = authTime ? Math.floor(Date.now() / 1000) - authTime : Number.POSITIVE_INFINITY;
      const MAX_STEP_UP_AGE_SEC = 5 * 60;
      if (ageSec > MAX_STEP_UP_AGE_SEC) {
        return next(
          new ApiError(
            401,
            'STEP_UP_REQUIRED',
            `re-authenticate within the last ${MAX_STEP_UP_AGE_SEC} seconds to perform ${perm}`,
          ),
        );
      }
    }
    next();
  };
}

export function requireCampusMember(req: Request, _res: Response, next: NextFunction): void {
  const cid = req.firebaseUser?.campusId as string | undefined;
  const role = callerRole(req);
  if (!cid || !role) {
    next(new ApiError(403, 'NOT_MEMBER', 'caller is not a campus member'));
    return;
  }
  next();
}
