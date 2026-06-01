// Express app factory + error handling helpers.

import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
  type RequestHandler,
} from 'express';
import type { z } from 'zod';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public field?: string,
  ) {
    super(message);
  }
}

// Validates `body` against `schema` and converts a Zod failure into a clean
// 400 with the first error's path + message, instead of letting the raw
// ZodError bubble up to a 500. The generic `S extends z.ZodTypeAny` with
// `z.infer<S>` preserves `.default()` / `.optional()` refinements that a
// `z.ZodSchema<T>` signature would erase.
export function parseBody<S extends z.ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
  const r = schema.safeParse(body);
  if (!r.success) {
    const first = r.error.errors[0];
    throw new ApiError(400, 'VALIDATION', first?.message ?? 'invalid body', first?.path.join('.'));
  }
  return r.data;
}

// Wraps async route handlers so thrown errors hit the error middleware
// instead of becoming unhandled rejections.
export function asyncHandler(fn: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApiError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.field ? { field: err.field } : {}) },
    });
    return;
  }
  const message = err instanceof Error ? err.message : 'Internal server error';
  process.stderr.write(`[server] unhandled: ${message}\n`);
  if (err instanceof Error && err.stack) process.stderr.write(err.stack + '\n');
  res.status(500).json({
    error: { code: 'INTERNAL', message: 'Internal server error' },
  });
}

export function createApp(): Express {
  const app = express();
  app.use(express.json({ limit: '32kb' }));
  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, service: 'beacon5-server' });
  });
  return app;
}
