// Express middleware that gates a route on a specific permission from §8.2.2.
// Must run AFTER verifyToken — relies on req.user.app_metadata claims.

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { Role } from '@beacon5/shared';
import { hasPermission, requiresStepUp, type Permission } from './permissions';
import { ApiError } from '../http';

function callerRole(req: Request): Role | null {
  const r = req.user?.app_metadata?.role;
  if (r === 'student' || r === 'parent' || r === 'staff' || r === 'admin') return r;
  return null;
}

export function requirePermission(perm: Permission): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new ApiError(401, 'AUTH_REQUIRED', 'no verified token'));
    const role = callerRole(req);
    if (!role) return next(new ApiError(403, 'NOT_MEMBER', 'caller has no campus role'));
    if (!hasPermission(role, perm)) {
      return next(new ApiError(403, 'FORBIDDEN', `role ${role} lacks permission ${perm}`));
    }
    if (requiresStepUp(perm)) {
      // PRD R8.2.3 — step-up auth. Supabase JWTs carry `aal` (assurance level)
      // and `auth_time` via the iat/issued-at + session_id pattern. We use
      // iat as a proxy: if the JWT was issued within the last 5 minutes,
      // call it step-up. Real MFA gate (aal === 'aal2') lands when we wire
      // Supabase MFA enrollment in a later step.
      const iat = req.user.iat;
      const ageSec = typeof iat === 'number' ? Math.floor(Date.now() / 1000) - iat : Number.POSITIVE_INFINITY;
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
  const cid = req.user?.app_metadata?.campus_id;
  const role = callerRole(req);
  if (!cid || !role) {
    next(new ApiError(403, 'NOT_MEMBER', 'caller is not a campus member'));
    return;
  }
  next();
}
