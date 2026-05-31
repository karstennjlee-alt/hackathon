// Beacon5 server entry point.
// Phase 0 step 2 (Supabase): auth routes (session, join, bootstrap, join-code) + RBAC.
// Phase 0 step 5 (AI proxy): server-side Gemini for clarify/brief/all-clear/polish.

import { env } from './env';
import { createApp, asyncHandler, errorHandler } from './http';
import { verifyToken } from './auth/verifyToken';
import { postSession } from './auth/session';
import { postJoin, postIssueJoinCode } from './auth/joinCode';
import { postBootstrap } from './auth/bootstrap';
import { requireCampusMember, requirePermission } from './rbac/requireRole';
import {
  postClarifyAlert,
  postBrief,
  postAllClear,
  postPolishBroadcast,
} from './ai/routes';

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

// ── AI proxy — all Gemini calls live here. Clients never get the key.
app.post('/v1/ai/clarify-alert',    verifyToken, requireCampusMember, asyncHandler(postClarifyAlert));
app.post('/v1/ai/brief',            verifyToken, requireCampusMember, asyncHandler(postBrief));
app.post('/v1/ai/all-clear',        verifyToken, requireCampusMember, asyncHandler(postAllClear));
app.post('/v1/ai/polish-broadcast', verifyToken, requireCampusMember, asyncHandler(postPolishBroadcast));

app.use(errorHandler);

const port = env.PORT;
app.listen(port, () => {
  process.stdout.write(
    `\nBeacon5 server running on http://localhost:${port}\n` +
      `  NODE_ENV=${env.NODE_ENV}\n` +
      `  SUPABASE_URL=${env.SUPABASE_URL}\n` +
      `  GEMINI_MODEL=${env.GEMINI_MODEL}\n` +
      `  routes:\n` +
      `    GET  /healthz\n` +
      `    POST /v1/auth/session        (Bearer Supabase JWT)\n` +
      `    POST /v1/auth/join           (Bearer + { code, displayName })\n` +
      `    POST /v1/auth/bootstrap      (Bearer + { orgName, campusName, displayName })\n` +
      `    POST /v1/auth/join-codes     (Bearer + { role, expiresInHours? }) — staff/admin\n` +
      `    POST /v1/ai/clarify-alert    (Bearer + { studentLabel, locationHint?, context? })\n` +
      `    POST /v1/ai/brief            (Bearer + { incidentType, campusName, ... })\n` +
      `    POST /v1/ai/all-clear        (Bearer + { campusName, durationMin? })\n` +
      `    POST /v1/ai/polish-broadcast (Bearer + { draft, audience })\n\n`,
  );
});
