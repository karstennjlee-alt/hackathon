# @beacon5/server

Authoritative backend for Beacon5 v2. Mediates every state change; clients never write to a global path.

**Status:** Phase 0 step 0 — scaffolding only. Env validator runs; API not wired yet.

## Run

```bash
cd server
npm install
cp .env.example .env          # fill in per KEYS.md
npm run dev                   # boots, validates env, exits cleanly until API is wired
```

If any required var is missing, the process exits with a message naming the var and its KEYS.md section.

## What goes here (Phase 0 steps 1–6, 12)

- `src/env.ts` — zod env validator (this scaffold)
- `src/index.ts` — HTTP entry (step 4)
- `src/auth/` — Apple/Google token verification, email/OTP, session mgmt (step 2)
- `src/rbac/` — permission middleware encoding PRD §8.2.2 matrix (step 3)
- `src/incidents/` — incident write validation, event dedup (step 4)
- `src/ai/` — Gemini proxy + provider-agnostic interface + fallback chain (step 5)
- `src/push/` — APNs/FCM dispatcher (step 6)
- `src/audit/` — immutable audit log writes (step 12)
- `src/firestore-rules/` — security rules scoped by `campusId` (step 1)

## Secret rotation schedule

| Item | Cadence |
|---|---|
| Gemini API key | quarterly + on any leak |
| Expo access token | quarterly |
| Apple Sign-In `.p8` (4.4) | annually |
| APNs `.p8` (6.3) | annually |
| Firebase service account | on staff turnover |
| Google OAuth client secrets | on suspected leak |

Track rotations in your password manager, not in this repo.

## Tenant isolation rules

Every Firestore read/write must filter by `campusId`. The middleware in `src/rbac/` enforces this at request time; the security rules in `src/firestore-rules/` enforce it at the database. **Both must pass** — defense in depth.
