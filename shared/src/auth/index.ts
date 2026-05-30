// Beacon5 auth contracts — request/response shapes shared between app, admin, server.
// The wire format is JSON; types here are the source of truth.

import type { ID, Role } from '../domain';

// ──────────────────────────────────────────────────────────────────
// Custom claims stamped onto Firebase ID tokens after /v1/auth/session
// or /v1/auth/join succeed. Rules read these directly (request.auth.token.*).
// ──────────────────────────────────────────────────────────────────
export interface SessionClaims {
  campusId: ID;
  role: Role;
  linkedStudents?: ID[]; // parents only
}

// ──────────────────────────────────────────────────────────────────
// POST /v1/auth/session
// Exchange a Firebase ID token (Apple/Google/email-link) for a session.
// If the caller already has a User record, mints/refreshes custom claims
// and returns the session. Otherwise returns 404 telling the client to
// redeem a join code.
// ──────────────────────────────────────────────────────────────────
export interface SessionRequest {}

export interface SessionResponse {
  uid: ID;
  campusId: ID;
  role: Role;
  displayName: string;
  isMinor: boolean;
  linkedStudents?: ID[];
}

// ──────────────────────────────────────────────────────────────────
// POST /v1/auth/join
// Redeems a one-time join code. Creates the User record + sets custom
// claims. The code's role + campusId are authoritative — the caller
// cannot pick their own role.
// ──────────────────────────────────────────────────────────────────
export interface JoinRequest {
  code: string;
  displayName: string;
}

export type JoinResponse = SessionResponse;

// ──────────────────────────────────────────────────────────────────
// POST /v1/auth/bootstrap
// One-time-only. The first authed user in a fresh deployment creates
// an Organization + Campus and becomes its first admin. Refuses after
// any Organization exists.
// ──────────────────────────────────────────────────────────────────
export interface BootstrapRequest {
  orgName: string;
  campusName: string;
  displayName: string;
}

export type BootstrapResponse = SessionResponse;

// ──────────────────────────────────────────────────────────────────
// POST /v1/auth/join-codes (staff/admin only, defined here for the contract,
// the route lands in the admin/roster module later)
// ──────────────────────────────────────────────────────────────────
export interface IssueJoinCodeRequest {
  role: Exclude<Role, 'parent'>; // parents come via guardian links, not codes
  expiresInHours?: number; // default 72
}

export interface IssueJoinCodeResponse {
  code: string; // human-typeable, e.g. ABCD-EF12
  role: Role;
  expiresAt: number;
}

// ──────────────────────────────────────────────────────────────────
// Error response shape — all errors use this format
// ──────────────────────────────────────────────────────────────────
export interface ApiError {
  error: {
    code: string;        // machine-readable, e.g. 'AUTH_REQUIRED'
    message: string;     // human-readable
    field?: string;      // for validation errors
  };
}
