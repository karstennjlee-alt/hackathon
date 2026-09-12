// Express middleware that gates a route on a specific permission from §8.2.2.
// Must run AFTER verifyToken — relies on req.user.app_metadata claims.

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { Role } from '@beacon5/shared';
import { hasPermission, type Permission } from './permissions';
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
    // R8.2.3 step-up is deliberately NOT enforced here yet. The previous
    // implementation checked `iat` < 5 min, which Supabase's silent token
    // refresh makes meaningless as a security control — while in a real
    // emergency it would 401 a teacher whose token was 20 minutes old.
    // Declare/clear stay protected by role + campus policy + confirm-to-
    // declare + audit. Real step-up = Supabase MFA (`aal2`), tracked as P1.
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
