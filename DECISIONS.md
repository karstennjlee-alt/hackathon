# Beacon5 v2 — Decisions log

The PRD's [§20 Open questions](PRD.md) need answers before we can ship. The prompt says: "for anything there, pick a sensible default, state the default in a DECISIONS.md, and keep moving." This is that file.

Each decision below is **a default**, not a final answer. When the user signals otherwise, update the row and the code together.

---

## D1. Single-campus self-serve first

> *PRD Q1: Single-campus self-serve first, or district-led sales first?*

**Default:** Single-campus self-serve first.

**Why:** The founder's pilot path is his own school + sister's school. Self-serve onboarding lets either pilot start tomorrow without a sales cycle. District-led sales requires a security review, DPA, and a procurement contact — a different workflow we'll add when an actual district asks.

**Impact on the build:** Admin console must support "I am an admin, I just made an org" without a separate district owner above me. The District/Org-owner persona in PRD §4 is real but P1; the v2 P0 build treats `Organization` and `Campus` as a 1-to-1 single-tenant pair by default, with the data model already supporting district rollups later.

---

## D2. Account provisioning model

> *PRD Q2: Who provisions student accounts — school (FERPA "school official") or parents (COPPA consent)?*

**Default:** Configurable per campus, default to **school-provisioned**.

**Why:** The FERPA "school official" exception is the cleanest legal path for K-12 and the friction we know best. Parent-provisioned (COPPA-style) is a real path for non-school orgs and for schools that prefer it, but it requires verifiable parental consent — a heavier flow we should only spin up when an org asks.

**Impact on the build:** `Campus.policy.studentProvisioning` enum = `'school' | 'parent'`. Default `'school'`. The school flow needs a roster import (P1) + join code per student; the parent flow needs a verifiable consent step (P1).

---

## D3. Location policy default

> *PRD Q3: Track only on personal activation, or also on campus-threat declaration?*

**Default:** Org-configurable; ship with **personal-activation only** as the default.

**Why:** Privacy-first matches PRD principle 3 ("location is sacred"). A scared student tapping the beacon has clearly consented to location. A campus-threat declared by staff does *not* mean every student has consented to having their location streamed to staff — even if many will activate their beacon shortly after. Schools that want broader coverage can opt in.

**Impact on the build:** `Campus.policy.locationPolicy` enum = `'on-activation' | 'on-threat' | 'never'`. Default `'on-activation'`. The student app reads this policy from the backend; `'on-threat'` arms passive tracking when a `CampusThreat` becomes active.

---

## D4. Threat-declaration policy

> *PRD Q4: Is "any staff can declare a threat" the right default, or admin-only with staff escalation?*

**Default:** Org-configurable; ship with **any-staff** as the default.

**Why:** Matches v1 behavior and many schools' actual posture — the closest adult to a threat is likely a teacher, not an admin. The risk (false alarm by a single teacher) is mitigated by step-up auth (R8.2.3) and easy clear (R8.4.5). Admin-only is right for orgs with strict chain-of-command (some districts, hospitals); they can flip the toggle.

**Impact on the build:** `Campus.policy.whoCanDeclareThreat` enum = `'any-staff' | 'admin-only'`. Default `'any-staff'`. Step-up auth required either way.

---

## D5. Apple Critical Alerts entitlement

> *PRD Q5: Pursue Apple approval for Critical Alerts, or ship with time-sensitive only?*

**Default:** Ship with **time-sensitive only** at launch. Pursue Critical Alerts entitlement post-launch.

**Why:** Critical Alerts require Apple approval with real deployment data (real schools using the product). We don't have that yet. Time-sensitive interrupts Do Not Disturb on iOS and is enough for the beacon + threat-declared use cases in pilots. We'll request the Critical Alerts entitlement when we have ≥1 school using Beacon5 in production and can show Apple the use case with real numbers.

**Impact on the build:** `expo-notifications` configured with `interruptionLevel: 'timeSensitive'` for threat/beacon, `'active'` for chat/broadcast. No Critical Alerts entitlement requested in v2 launch.

---

## D6. Replace LLM area-description with reverse-geocoding API

> *PRD Q6: Use a real reverse-geocoding API for area descriptions?*

**Default:** **Yes.** Use **Google Geocoding API** for the coords → place lookup, then Gemini for the brief one-line phrasing on top.

**Why:** PRD §9.2 notes this is more accurate. Asking an LLM to invent an area name from raw lat/lng is exactly the kind of hallucination the AI guardrails (R8.7.7) forbid. A geocoder gives a real, reverse-lookupable answer; the LLM then renders it as "near the cafeteria entrance" — phrasing only, no fact invention.

**Impact on the build:** Backend `/v1/ai/area-description` calls Geocoding API first, passes the result + the active zone map (PRD §8.10.3) to the LLM for phrasing. Add `GOOGLE_GEOCODING_API_KEY` to `server/.env` (see [KEYS.md §3](KEYS.md)).

---

## Architectural decisions (not from PRD §20, but worth pinning)

### D7. Monorepo tool

**Default:** **npm workspaces** (built-in). No Turborepo / Nx / pnpm.

**Why:** Founder already uses npm. Workspaces handles the cross-package types we need (shared types between app, admin, server) without adding a build-graph tool. We can graduate to Turborepo if build times become a problem; they won't in Phase 0.

### D8. Backend hosting

**Default:** **Node + Express on a long-running host** (Fly.io / Render / Cloud Run, TBD) for the API + AI proxy. Supabase Edge Functions for thin server-side endpoints that need to be close to the database.

**Why:** v2 pivoted from Firebase Cloud Functions to Supabase. We still want a separate Node backend for the Gemini proxy (server-only key), push dispatcher, complex multi-table operations, and audit log writes — Supabase Edge Functions are stateless Deno + tightly scoped and are not where we want long-running AI calls. Hot-path target (1.5s p95) demands a warm instance.

**Updated 2026-05-24:** Switched from Firebase to Supabase — see D9.

### D9. Realtime layer + database

**Default:** **Supabase Postgres** for all structured data + **Supabase Realtime** (Postgres replication) for live subscriptions. Row Level Security policies on every table, all scoped by `campus_id`.

**Why:** Real database + real SQL + real foreign keys + real transactions — better fit for the relational structure (Organization → Campus → Users / Incidents / Messages / Audit) than Firestore's eventually-consistent document model. RLS is more powerful than Firestore rules (full SQL expressivity, no `get()`-fee-per-rule). Realtime gives us per-row subscriptions for free.

**Updated 2026-05-24:** Switched from Firestore + RTDB to Supabase Postgres + Realtime. v1 monolith stays on Firebase RTDB on `main`; v2 starts fresh on Supabase.

**Risk:** No mature managed offline-first sync the way Firebase RTDB has. v1's offline event queue (AsyncStorage + serverTimestamp dedup) ports cleanly — we keep that pattern in v2.

### D10. AI provider abstraction

**Default:** Server-side TS interface `AIProvider` with two implementations to start: `GeminiFlashProvider` (primary) and `TemplateProvider` (deterministic fallback). Add a secondary model provider in Phase 1.

**Why:** PRD §9.2.2 — provider-agnostic. The interface is cheap to write now; switching providers when we need to is impossible if everything imports `@google/genai` directly.

### D11. Demo / seed data

**Default:** `EXPO_PUBLIC_DEMO=false` in production builds. The whole roster + zone seed lives behind this flag and is **stripped at build time** when false. No demo data in the prod bundle.

**Why:** PRD §10.2 — "Remove all seed/demo constants from runtime code; demo data lives behind an explicit demo flag only."

### D12. Secret rotation

**Default:** Document a key rotation schedule in `server/README.md`: APNs/Apple keys annually, Gemini key quarterly, Expo access token quarterly, service accounts on staff turnover.

**Why:** Not glamorous. Will matter when an intern leaves.
