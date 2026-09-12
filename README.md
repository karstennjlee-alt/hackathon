# Beacon5 — v2 branch

Real-time campus & facility safety platform. **You are on the `v2` (production rewrite) branch.** The hackathon-winning v1 prototype lives on `main`, untouched.

> Beacon5 is a coordination tool. It is **not** a replacement for 911 or emergency dispatch.

---

## Read these first, in this order

| File | What it is |
|---|---|
| [PRD.md](PRD.md) | The product spec. Source of truth. |
| [PLAN.md](PLAN.md) | Phase plan + repo layout. How we'll execute the PRD. |
| [DECISIONS.md](DECISIONS.md) | Defaults applied for PRD §20 open questions + key architectural calls. |
| [KEYS.md](KEYS.md) | **Every key, where to get it, server vs client.** This is what unblocks running anything. |
| [TODO.md](TODO.md) | Every R8.x.x requirement with current status. |
| [DESIGN.md](DESIGN.md) | Design language — tokens, components, state vocabulary. Read before any screen work. |

---

## Repo layout (npm workspaces)

```
beacon5/
├── PRD / PLAN / KEYS / DECISIONS / TODO / DESIGN (docs)
├── app/         — Expo + RN + TS mobile app (v1 monolith + new v2 auth/sign-in)
├── admin/       — Vite + React + TS web admin console (Phase 0 step 11)
├── server/      — Node + TS backend (Express; AI proxy + RBAC + push + Supabase Admin)
├── shared/      — Cross-package types + auth contracts + AI prompt templates
└── supabase/    — SQL migrations (Postgres schema + RLS policies)
```

The v1 6000-line `App.tsx` is moved to `app/App.tsx` on this branch and will be split into `app/src/{auth,incident,location,comms,maps,ai,ui,domain}/` during Phase 0 step 7. Until then it runs unchanged via `cd app && npx expo start --tunnel`.

---

## Running things

### Mobile (v1 monolith for now)

```bash
cd app
cp .env.example .env       # fill in client-safe values per KEYS.md
npx expo start --tunnel
```

### Server (not built yet)

```bash
cd server
cp .env.example .env       # fill in server secrets per KEYS.md
npm run dev                # added in Phase 0 step 4
```

### Admin console (not built yet)

```bash
cd admin
cp .env.example .env       # client-safe only per KEYS.md
npm run dev                # added in Phase 0 step 11
```

If you start either of the above and any required env var is missing, the env validator throws with a message naming the var, the file, and the section of [KEYS.md](KEYS.md). No silent misconfiguration.

---

## What's done vs what's next

See [TODO.md](TODO.md) for the requirement-level picture.

**Working end-to-end against the dev Supabase project (verified 2026-09-11):**
- Sign in → `JoinCampusScreen` → redeem a join code *or* create a new campus (self-serve, D1)
- Monolith runs off the real identity (`AppIdentity`): no roster picker, real campus name, Supabase sign-out
- Incident lifecycle: activate → location stream → reset/clear, mirrored to the server and back to every device via Realtime (INSERT + UPDATE)
- Campus threat declare/clear, chat, mass + staff broadcasts, AI proxy with Gemini → template fallback
- Migrations `002` (students read their own broadcasts) and `003` (join-code FK fix) applied

**Next:**
- Real step-up auth (Supabase MFA `aal2` or re-auth challenge) — the current `iat` check is cosmetic
- Server push (Expo Push) — notifications are still local-only
- Guardian linking + parent join path
- Admin console (`admin/` is still a README)
- Split `App.tsx` into modules (step 7)
