// Beacon5 server entry point.
// Phase 0 step 2 (Supabase): auth routes (session, join, bootstrap, join-code) + RBAC.

import { env } from './env';
import { createApp, asyncHandler, errorHandler } from './http';
import { verifyToken } from './auth/verifyToken';
import { postSession } from './auth/session';
import { postJoin, postIssueJoinCode } from './auth/joinCode';
import { postBootstrap } from './auth/bootstrap';
import { requireCampusMember, requirePermission } from './rbac/requireRole';

const app = createApp();

app.post('/v1/auth/session',   verifyToken, asyncHandler(postSession));
app.post('/v1/auth/join',      verifyToken, asyncHandler(postJoin));
app.post('/v1/auth/bootstrap', verifyToken, asyncHandler(postBootstrap));

app.post(
  '/v1/auth/join-codes',
  verifyToken,
  requireCampusMember,
  requirePermission('joincode:issue'),
  asyncHandler(postIssueJoinCode),
);

app.use(errorHandler);

const port = env.PORT;
app.listen(port, () => {
  process.stdout.write(
    `\nBeacon5 server running on http://localhost:${port}\n` +
      `  NODE_ENV=${env.NODE_ENV}\n` +
      `  SUPABASE_URL=${env.SUPABASE_URL}\n` +
      `  routes:\n` +
      `    GET  /healthz\n` +
      `    POST /v1/auth/session    (Bearer Supabase JWT)\n` +
      `    POST /v1/auth/join       (Bearer + { code, displayName })\n` +
      `    POST /v1/auth/bootstrap  (Bearer + { orgName, campusName, displayName })\n` +
      `    POST /v1/auth/join-codes (Bearer + { role, expiresInHours? }) — staff/admin\n\n`,
  );
});
