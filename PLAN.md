# Beacon5 v2 — Build Plan

Source of truth: [PRD.md](PRD.md). This is the execution plan.

---

## Phases

### Phase 0 — Productionize the core (P0, launch blocker)

The only phase we're committing to right now. Everything else is a roadmap entry.

| # | Module | PRD ref | Gap closed |
|---|---|---|---|
| 0 | **Repo + env scaffolding** — workspaces, 3 `.env.example`, [KEYS.md](KEYS.md), `.gitignore`, fail-loud env validation | §3, §10.4 | — |
| 1 | **Multi-tenant data model + security rules** scoped by `campusId`; remove global `beacon5/events` path; PRD §12 schema in Firestore + RTDB | §10, §12 | **G4** |
| 2 | **Real auth + org-scoped roles** — email/OTP + Sign in with Apple + Google; org binding; invitation/join-code/roster/domain verification; verified guardian linking; `expo-secure-store` | §8.1 | **G1**, **G3** (partial) |
| 3 | **Server-enforced RBAC + step-up auth** for declare/clear threat and "everyone" broadcasts; replaces `'cwb'` | §8.2 | **G3** |
| 4 | **Authoritative backend + write validation** — every event server-validated; offline queue dedup by event id | §10.3 | **G7** |
| 5 | **AI proxy** — `/ai/clarify-alert | /brief | /all-clear | /polish-broadcast`; prompt templates + hard caps in code; provider-agnostic; fallback chain; keys in KMS | §8.7, §9 | **G2** |
| 6 | **Server push (APNs/FCM)** — critical/time-sensitive, audience-scoped, minimal lock-screen content | §8.9 | **G9** |
| 7 | **Config-driven mobile app** — campus name, zones, roster, branding, policy from backend at runtime; refactor monolith into `auth/`, `incident/`, `location/`, `comms/`, `maps/`, `ai/`, `ui/`, `domain/`; gate demo data | §10.2, §16 | **G5**, **G8** |
| 8 | **Beacon & escalation** — keep 1s hold + haptics + ring; add accessible alternative trigger (R8.5.2); threat/medical escalation; silent by default | §8.5 | — |
| 9 | **Location** — off by default; on only during active incident/policy-tied threat; keep v1's last-known→fresh-fix→watcher + accuracy filter + smoothing; always show accuracy radius + "approximate / GPS pending"; visible "tracking active" indicator; stop on clear | §8.6 | — |
| 10 | **Communication** — staff↔guardian chat scoped to student/incident; audience-targeted mass broadcasts; immutable audit log (retract/supersede in UI, never silently delete) | §8.8 | — |
| 11 | **Admin console (web)** — org/campus creation, roster management, zone editor (replaces v1's 4 hardcoded zones), branding (replaces "San Jose High"), policy config, read-only exportable audit log | §8.10, §16 | **G5** |
| 12 | **Compliance program** — consent records, configurable retention + auto-purge of location traces, deletion requests, immutable audit, data minimization | §11 | **G6** |
| 13 | **Accessibility baseline** — WCAG 2.1 AA; screen-reader labels on every control; dynamic type; focus order; no info by color alone | §8.11 | **G10** |
| 14 | **Store readiness** — purpose strings; privacy nutrition / data safety; in-app account deletion; background location justification + demo video | §15 | — |

### Phase 1 — Hardening & reach
SIS/CSV roster import, admin MFA, message templates + ack + translation, localization, drill mode + analytics, district rollups, read receipts. **Don't start until Phase 0 is solid.**

### Phase 2 — Differentiation
Indoor positioning / BLE, on-device fallback model, wearable trigger, cross-campus mutual-aid, data residency, SOC 2, PA/notification integrations.

---

## Repo layout (npm workspaces monorepo)

```
beacon5/                       (v2 branch)
├── PRD.md                     authoritative spec
├── README.md                  top-level orientation
├── PLAN.md                    this file
├── KEYS.md                    every key, where to get it, server vs client
├── DECISIONS.md               defaults for PRD §20 open questions
├── TODO.md                    R8.x.x requirement tracker (status per req)
├── DESIGN.md                  design language note (tokens, components, states)
├── package.json               workspaces root (app/, admin/, server/, shared/)
├── tsconfig.base.json
├── .gitignore
│
├── app/                       Expo + RN + TS mobile app
│   ├── package.json
│   ├── app.json
│   ├── App.tsx                (v1 monolith for now; split in step 7)
│   ├── index.ts
│   ├── tsconfig.json
│   ├── .env.example           CLIENT-SAFE only (EXPO_PUBLIC_*)
│   ├── src/
│   │   ├── env.ts             validates EXPO_PUBLIC_* at boot, throws if missing
│   │   ├── auth/              (step 2)
│   │   ├── incident/          (step 8)
│   │   ├── location/          (step 9)
│   │   ├── comms/             (step 10)
│   │   ├── maps/              (step 9)
│   │   ├── ai/                (step 5 — calls /v1/ai/* only)
│   │   ├── ui/                (step 13)
│   │   └── domain/            (typed events; from shared/)
│   └── assets/
│
├── admin/                     Web admin console (Vite + React + TS)
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env.example           CLIENT-SAFE only (VITE_*)
│   └── src/
│       └── README.md          (step 11 fills this in)
│
├── server/                    Node + TS backend (Cloud Functions or managed service)
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env.example           SERVER SECRETS — Gemini, service accounts, .p8s
│   └── src/
│       ├── env.ts             zod-validated env loader; fails loud
│       ├── index.ts           HTTP entry (step 4)
│       ├── auth/              (step 2 — Apple/Google/email verification)
│       ├── rbac/              (step 3 — permission middleware)
│       ├── incidents/         (step 4)
│       ├── ai/                (step 5 — Gemini proxy, fallback chain)
│       ├── push/              (step 6 — APNs/FCM dispatcher)
│       ├── audit/             (step 12)
│       └── firestore-rules/   (step 1)
│
└── shared/                    Types + env schemas + AI prompt templates
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── env-schema.ts      zod schemas used by app, admin, server
        ├── domain/            Event, Incident, Message, User, Campus types
        └── prompts/           (step 5 — versioned AI prompt templates)
```

---

## How we work in this session

1. **Docs first.** PRD + PLAN + KEYS + DECISIONS + TODO + DESIGN before any feature code. You need KEYS.md to provision keys in parallel.
2. **Monorepo skeleton next.** Workspaces wired up, v1 moved into `app/`, empty stubs in `admin/`, `server/`, `shared/`.
3. **Env validation last (this session).** zod schemas in `shared/`, fail-loud loaders in `app/` and `server/`. Missing var → error names the var, the file, and the KEYS.md anchor.

Everything beyond that is the next session.

---

## Commit cadence

- **C1**: docs (PRD already in. Add PLAN, KEYS, DECISIONS, TODO, DESIGN, README).
- **C2**: monorepo skeleton — move v1 into `app/`, add `admin/`, `server/`, `shared/`, workspace `package.json`, base tsconfig.
- **C3**: 3 `.env.example` files + zod env validation + boot-time check.

Each commit is independently reviewable.

---

## What's NOT in scope this session

- No feature code (auth, RBAC, AI proxy, push) — those are steps 2–13 above, future sessions.
- No actual Firebase project creation, key provisioning, or admin console UI.
- No splitting of `App.tsx` yet. It stays as `app/App.tsx` until step 7. The v1 monolith still runs via `cd app && npx expo start`.
- No `main` branch changes. The winning v1 prototype stays untouched.
