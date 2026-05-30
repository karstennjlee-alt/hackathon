// verifyToken middleware — extracts and verifies a Supabase user JWT from
// the Authorization header. Attaches the decoded token + raw JWT to req.user.
//
// Supabase signs JWTs with the project's JWT secret (HS256). We verify locally
// without a network call — same approach Supabase's own server libs use.

import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { ApiError } from '../http';
import { env } from '../env';

export interface SupabaseJwtPayload extends jwt.JwtPayload {
  sub: string;                  // auth user id (uuid)
  email?: string;
  phone?: string;
  role?: string;                // 'authenticated' (auth.role, not our app role)
  aud?: string | string[];
  app_metadata?: {
    campus_id?: string;
    role?: 'student' | 'parent' | 'staff' | 'admin';
    provider?: string;
    providers?: string[];
  };
  user_metadata?: Record<string, unknown>;
  aal?: 'aal1' | 'aal2';        // assurance level — aal2 = MFA
}

declare global {
  namespace Express {
    interface Request {
      user?: SupabaseJwtPayload;
      jwt?: string;
    }
  }
}

export async function verifyToken(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.header('authorization') ?? req.header('Authorization');
    if (!header || !header.startsWith('Bearer ')) {
      throw new ApiError(401, 'AUTH_REQUIRED', 'Bearer token required in Authorization header');
    }
    const token = header.slice('Bearer '.length).trim();
    if (!token) throw new ApiError(401, 'AUTH_REQUIRED', 'Bearer token is empty');

    const decoded = jwt.verify(token, env.SUPABASE_JWT_SECRET, {
      algorithms: ['HS256'],
    }) as SupabaseJwtPayload;

    if (!decoded.sub) throw new ApiError(401, 'AUTH_INVALID', 'token missing sub claim');

    req.user = decoded;
    req.jwt = token;
    next();
  } catch (err) {
    if (err instanceof ApiError) return next(err);
    if (err instanceof jwt.TokenExpiredError) {
      return next(new ApiError(401, 'AUTH_EXPIRED', 'token expired'));
    }
    if (err instanceof jwt.JsonWebTokenError) {
      return next(new ApiError(401, 'AUTH_INVALID', `token verification failed: ${err.message}`));
    }
    next(new ApiError(401, 'AUTH_INVALID', 'token verification failed'));
  }
}
