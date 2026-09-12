// verifyToken middleware — extracts and verifies a Supabase user JWT from
// the Authorization header. Attaches the decoded token + raw JWT to req.user.
//
// Supabase projects now sign sessions with an asymmetric key (ES256/RS256)
// published at /auth/v1/.well-known/jwks.json; older projects (and tokens
// minted in tests from the legacy secret) use HS256. We look at the token
// header and verify accordingly — JWKS is cached and refreshed by jose.

import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { createRemoteJWKSet, jwtVerify, decodeProtectedHeader, errors as joseErrors } from 'jose';
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

const JWKS = createRemoteJWKSet(new URL('/auth/v1/.well-known/jwks.json', env.SUPABASE_URL), {
  cooldownDuration: 30_000,
  cacheMaxAge: 10 * 60_000,
});

const ASYMMETRIC = new Set(['ES256', 'RS256', 'ES384', 'RS384', 'ES512', 'RS512']);

async function verify(token: string): Promise<SupabaseJwtPayload> {
  const { alg } = decodeProtectedHeader(token);
  if (alg && ASYMMETRIC.has(alg)) {
    const { payload } = await jwtVerify(token, JWKS, { algorithms: [alg] });
    return payload as unknown as SupabaseJwtPayload;
  }
  if (alg === 'HS256') {
    return jwt.verify(token, env.SUPABASE_JWT_SECRET, { algorithms: ['HS256'] }) as SupabaseJwtPayload;
  }
  throw new ApiError(401, 'AUTH_INVALID', `unsupported token algorithm ${alg ?? '(none)'}`);
}

export async function verifyToken(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.header('authorization') ?? req.header('Authorization');
    if (!header || !header.startsWith('Bearer ')) {
      throw new ApiError(401, 'AUTH_REQUIRED', 'Bearer token required in Authorization header');
    }
    const token = header.slice('Bearer '.length).trim();
    if (!token) throw new ApiError(401, 'AUTH_REQUIRED', 'Bearer token is empty');

    const decoded = await verify(token);
    if (!decoded.sub) throw new ApiError(401, 'AUTH_INVALID', 'token missing sub claim');

    req.user = decoded;
    req.jwt = token;
    next();
  } catch (err) {
    if (err instanceof ApiError) return next(err);
    if (err instanceof jwt.TokenExpiredError || err instanceof joseErrors.JWTExpired) {
      return next(new ApiError(401, 'AUTH_EXPIRED', 'token expired'));
    }
    if (err instanceof jwt.JsonWebTokenError || err instanceof joseErrors.JOSEError) {
      return next(new ApiError(401, 'AUTH_INVALID', `token verification failed: ${err.message}`));
    }
    next(new ApiError(401, 'AUTH_INVALID', 'token verification failed'));
  }
}
