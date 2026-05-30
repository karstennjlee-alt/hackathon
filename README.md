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
├── app/         — Expo + RN + TS mobile app (v1 monolith lives here for now)
├── admin/       — Vite + React + TS web admin console (Phase 0 step 11)
├── server/      — Node + TS backend (Cloud Functions; AI proxy + RBAC + push)
└── shared/      — Cross-package types, env schemas, AI prompt templates
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

This branch is at the end of **Phase 0 step 0** (scaffolding). See [TODO.md](TODO.md) for the full picture.

**Done this session:**
- v2 branch created
- All Phase-0 planning docs written
- Monorepo skeleton with `app/`, `admin/`, `server/`, `shared/`
- 3 `.env.example` files (one per package, client-safe vs server-only firewall)
- zod env validation that fails loud at boot

**Next session:**
- Phase 0 step 1 — multi-tenant data model + Firestore/RTDB security rules scoped by `campusId`
- Phase 0 step 2 — real auth (email/OTP + Apple + Google) with verified org binding

---

## v1 (hackathon prototype)

`git checkout main`. The 6000-line single-file Expo app that won 1st place at Synthesis Hacks lives there, untouched. Don't lose it.

---

## Disclaimer

Beacon5 supports — never replaces — 911 and the school's crisis plan. The product is designed to coordinate trained human responders, not to dispatch them.
