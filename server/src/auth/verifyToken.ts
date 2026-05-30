// verifyToken middleware — extracts and verifies a Firebase ID token from
// the Authorization header. Attaches the decoded token to req.firebaseUser.
//
// Any provider configured in Firebase Auth (Apple, Google, email-link,
// email/password, custom token) produces compatible ID tokens.

import type { Request, Response, NextFunction } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { auth } from '../firebase';
import { ApiError } from '../http';

declare global {
  namespace Express {
    interface Request {
      firebaseUser?: DecodedIdToken;
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
    if (!token) {
      throw new ApiError(401, 'AUTH_REQUIRED', 'Bearer token is empty');
    }
    const decoded = await auth.verifyIdToken(token, true);
    req.firebaseUser = decoded;
    next();
  } catch (err) {
    if (err instanceof ApiError) {
      next(err);
      return;
    }
    next(new ApiError(401, 'AUTH_INVALID', 'Token verification failed'));
  }
}
