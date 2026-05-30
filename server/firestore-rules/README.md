# Beacon5 v2 — Firebase security rules

> ⚠ **DO NOT DEPLOY YET.** These rules require auth + custom claims, which land in **Phase 0 step 2** (auth). Deploying now will lock out the running v1 monolith (which writes anonymously to `/beacon5/events`) and any other unauthenticated client.

This directory holds the production-grade security rules for Beacon5 v2. They are committed for code review and so the surface is locked down the moment auth ships. They close **gap G4** (no tenant isolation) from PRD §6.2.

## Files

| File | What it covers |
|---|---|
| [`firestore.rules`](firestore.rules) | Tenant isolation by `campusId`, role-based read/write, immutable audit + messages, server-only writes for everything except presence |
| [`firestore.indexes.json`](firestore.indexes.json) | Composite indexes for staff fleet view, message feed, chat-per-student, audit, roster |
| [`database.rules.json`](database.rules.json) | RTDB low-latency state (threat status mirror, beacon heartbeats, presence) — same campus-scoping |
| [`storage.rules`](storage.rules) | Campus branding logos; server-only writes |

## Custom claims contract

Every authenticated user must have these claims set server-side after sign-in (Phase 0 step 2 wires this):

```ts
{
  campusId:        string,       // tenant
  role:            'student' | 'parent' | 'staff' | 'admin',
  linkedStudents?: string[],     // for parents only: student userIds they may see
}
```

Without these, rules deny by default — defense in depth.

## Tenant model (PRD §10–12)

Every Firestore document a client reads lives under:

```
/campuses/{campusId}/<collection>/<docId>
```

The rules check `request.auth.token.campusId == campusId` on every path. Cross-campus reads are impossible at the database layer, not just the application layer. The v1 global `/beacon5/events` RTDB path is **gone** in this model — there is no shared/global namespace.

## Deploy (when step 2 lands)

```bash
# Install Firebase CLI (one-time)
npm install -g firebase-tools

# Sign in
firebase login

# Pick the project (do this once per checkout)
firebase use beacon5-7981f       # dev project
# firebase use beacon5-staging   # later
# firebase use beacon5-prod      # later

# Deploy everything
firebase deploy --only firestore:rules,firestore:indexes,database,storage

# Or one at a time
firebase deploy --only firestore:rules
firebase deploy --only database
firebase deploy --only storage
```

`firebase.json` at the repo root points to the files in this directory, so you can run the command from anywhere in the repo.

## Test before deploying

```bash
firebase emulators:start --only firestore,database,storage,auth
```

The Firebase Local Emulator Suite runs the rules locally. Connect the v2 app and admin console with their `FIREBASE_*` env vars pointed at the emulator (see [Firebase emulator docs](https://firebase.google.com/docs/emulator-suite)).

We will add unit tests for the rules in Phase 0 step 4 using `@firebase/rules-unit-testing` — every role × every collection × every operation should have a passing/failing test pair.

## What about the running v1 monolith?

The v1 app on `main` writes to `/beacon5/events` in RTDB. After the env swap, it now writes to the new `beacon5-7981f` project, which is in Firebase **test mode** (open for ~30 days from project creation, then locked down).

Three options for the cutover window:

1. **Recommended:** Keep v1 running on test-mode rules until Phase 0 step 7 (config-driven app) is done. Then deploy these v2 rules and retire v1. ([DECISIONS.md](../../DECISIONS.md) D2 covers the user-provisioning path.)
2. Extend test-mode by another 30 days in the Firebase console if it expires before step 7.
3. Create a separate Firebase project for v1 demos (`beacon5-v1-demo`) and let it stay in test mode forever.

Whatever you do — **don't deploy these rules to a project where v1 is still active.**

## What's not yet in the rules

- **Write validation** (R8.7.7 — incident AI input/output size caps, length limits on broadcasts, no `kind` switching after creation). All writes are server-only right now, so the backend will validate; client-side rule-level write validation is a P1 reinforcement.
- **Step-up auth gating** at the rule level. Step-up for `declare/clear threat` and mass-broadcast-to-everyone is enforced server-side (R8.2.3); we could add a rule check on `auth.token.amr` (recent auth) but it adds complexity for marginal defense — server is the source of truth.
- **Retention enforcement**. PRD §11 — auto-purge `LocationPoint` records after `campus.policy.retentionDays`. That's a scheduled function (Phase 0 step 12), not a rule.

## Anchor in TODO.md

This work closes the row under §10 Architecture work: "Firestore + RTDB scoped by `campusId` with security rules." Step 1 status in PLAN.md.
