// Beacon5 server entry point.
// Phase 0 step 2 (Supabase): auth routes (session, join, bootstrap, join-code) + RBAC.
// Phase 0 step 5 (AI proxy): server-side Gemini for clarify/brief/all-clear/polish.
// Phase 0 step 4 (incidents/threat/messaging): authoritative writes for the core data flows.

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
import {
  postActivateIncident,
  postClearIncident,
  postIncidentLocation,
} from './incidents/routes';
import { postDeclareThreat, postClearThreat } from './incidents/threat';
import { postChatMessage, postMassMessage } from './messaging/routes';

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

// ── Incidents — student beacon flow.
app.post(
  '/v1/incidents',
  verifyToken,
  requireCampusMember,
  requirePermission('beacon:activate'),
  asyncHandler(postActivateIncident),
);
app.post(
  '/v1/incidents/:id/clear',
  verifyToken,
  requireCampusMember,
  requirePermission('incident:verify'),
  asyncHandler(postClearIncident),
);
app.post(
  '/v1/incidents/:id/location',
  verifyToken,
  requireCampusMember,
  requirePermission('beacon:activate'),
  asyncHandler(postIncidentLocation),
);

// ── Campus-wide threat — step-up enforced inside requirePermission().
app.post(
  '/v1/threat/declare',
  verifyToken,
  requireCampusMember,
  requirePermission('threat:declare'),
  asyncHandler(postDeclareThreat),
);
app.post(
  '/v1/threat/clear',
  verifyToken,
  requireCampusMember,
  requirePermission('threat:clear'),
  asyncHandler(postClearThreat),
);

// ── Messaging — chat (incident-scoped) + mass (campus-wide).
app.post(
  '/v1/messages/chat',
  verifyToken,
  requireCampusMember,
  requirePermission('chat:send'),
  asyncHandler(postChatMessage),
);
app.post(
  '/v1/messages/mass',
  verifyToken,
  requireCampusMember,
  asyncHandler(postMassMessage),
);

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
      `    POST /v1/ai/polish-broadcast (Bearer + { draft, audience })\n` +
      `    POST /v1/incidents           (Bearer + { escalation?, lastKnownCoords?, zoneHint? })\n` +
      `    POST /v1/incidents/:id/clear (Bearer)  — staff/admin\n` +
      `    POST /v1/incidents/:id/location (Bearer + { coords }) — owner only\n` +
      `    POST /v1/threat/declare      (Bearer) — step-up; gated by campus.policy\n` +
      `    POST /v1/threat/clear        (Bearer) — step-up\n` +
      `    POST /v1/messages/chat       (Bearer + { studentUserId, body })\n` +
      `    POST /v1/messages/mass       (Bearer + { audience, body })\n\n`,
  );
});
