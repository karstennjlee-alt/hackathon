# Beacon5 v2 — Requirement tracker

Every R8.x.x and Gx from [PRD.md](PRD.md), with current status. Update as we ship.

**Statuses:** ⬜ not-started · 🟡 in-progress · ✅ done · 🟢 v1 carried forward (works in monolith, still needs server move) · 🚫 P1/P2 (not this phase)

Last refreshed: end of scaffolding session.

---

## Phase 0 — Critical gaps (PRD §6.2)

| # | Gap | Status | Notes |
|---|---|---|---|
| G1 | No real authentication | 🟡 | Server auth scaffolded — `/v1/auth/{session,join,bootstrap,join-codes}` with custom claims. App client integration is next session. |
| G2 | Secrets in client bundle | ⬜ | Replaced by AI proxy + KMS — Phase 0 step 5 |
| G3 | Hard-coded `'cwb'` password | 🟡 | RBAC matrix + `requirePermission` + step-up (auth_time ≤ 5 min) shipped server-side; gates apply once incident/threat routes land in step 4. |
| G4 | Global event log | 🟡 | Rules written (not deployed) — `server/firestore-rules/`. Deploy when step 2 (auth) lands. |
| G5 | Hard-coded campus/zones/roster | ⬜ | Replaced by config-driven UI + admin console — steps 7 + 11 |
| G6 | No privacy/compliance controls | ⬜ | Compliance program — step 12 |
| G7 | No server-side validation | ⬜ | Authoritative backend — step 4 |
| G8 | Monolithic single file with seed data | 🟡 | Monolith now lives in `app/`; split into modules in step 7 |
| G9 | Local-only notifications | ⬜ | Server push — step 6 |
| G10 | No accessibility/i18n guarantees | ⬜ | A11y baseline — step 13 |

---

## §8.1 Auth & identity

| Req | Status | Note |
|---|---|---|
| R8.1.1 — email/OTP + Apple + Google | 🟡 | Server accepts any Firebase Auth provider; need Firebase console toggle. Email-link works zero-config; Apple/Google need keys per KEYS.md §4 §5. |
| R8.1.2 — bound to one verified org + role; never self-selected | 🟡 | Enforced server-side in `join` + `bootstrap`: collectionGroup check before insert; role comes from code, not request body. |
| R8.1.3 — invitation/verification-gated join | 🟡 | Join codes shipped (`/v1/auth/join-codes` + `/v1/auth/join`); domain-verified email + roster import are P1. |
| R8.1.4 — verified guardian linking | ⬜ | Contract drafted in `shared/src/auth/`; endpoint lands next session. |
| R8.1.5 — `expo-secure-store` tokens, refresh, server revocation | ⬜ | App-side, next session. Server revocation works today (Firebase `revokeRefreshTokens`). |
| R8.1.6 — recovery cannot hijack role-bearing identity | ⬜ | Future. Today: deletion + re-bootstrap is admin-only. |
| R8.1.7 — minor handling + FERPA school-official path | 🟡 | `isMinor` flag set true for students in `joinCode.ts`; full FERPA pathway via admin console (step 11). |
| R8.1.8 — admin MFA / SIS import / SSO | 🚫 | P1/P2 |

## §8.2 RBAC

| Req | Status | Note |
|---|---|---|
| R8.2.1 — server-enforced permissions | 🟡 | `requireCampusMember` + `requirePermission(perm)` middleware shipped; routes adopt them in step 4. |
| R8.2.2 — baseline permission matrix | 🟢 | Encoded in [`server/src/rbac/permissions.ts`](server/src/rbac/permissions.ts). |
| R8.2.3 — step-up auth for declare/clear/everyone broadcast | 🟡 | `requirePermission` checks `auth_time` ≤ 5 min for STEP_UP_PERMISSIONS; client re-auth flow lands in step 4. |
| R8.2.4 — who-can-declare-threat is org-configurable | ⬜ | per [DECISIONS.md D4](DECISIONS.md): default `any-staff` |

## §8.3 Multi-tenancy

| Req | Status | Note |
|---|---|---|
| R8.3.1 — Organization → Campus → Users/Zones/Incidents/Messages | 🟡 | types in `shared/src/domain/`; Firestore schema reflected in rules |
| R8.3.2 — hard isolation by `campusId` in rules + server | 🟡 | rules written (`server/firestore-rules/`); not deployed until auth lands |
| R8.3.3 — per-campus config/branding/roster/zones/retention/audit | ⬜ | rules permit; admin console (step 11) populates |
| R8.3.4 — district rollups / mutual aid | 🚫 | P1/P2 |

## §8.4 Campus threat declaration

| Req | Status | Note |
|---|---|---|
| R8.4.1 — arms all campus devices | 🟢 | works in v1, must route through server |
| R8.4.2 — declare/clear require step-up + audited | ⬜ | step-up is new |
| R8.4.3 — all-clear disarms + AI-assisted broadcast | 🟢 | works in v1 (server-side now) |
| R8.4.4 — drill mode | 🚫 | P1 |
| R8.4.5 — misfire protection (confirm + fast clear + auto-extend) | 🟡 | confirm-to-declare exists in v1; auto-extend is new |

## §8.5 Student beacon & escalation

| Req | Status | Note |
|---|---|---|
| R8.5.1 — 1s hold + haptics + ring | 🟢 | keep as-is |
| R8.5.2 — accessible alternative trigger | ⬜ | **new P0** — press-and-hold cannot be only path |
| R8.5.3 — on activation: incident + location + staff/guardian notify | 🟢 | server move |
| R8.5.4 — preset chips + freeform + AI-clarified | 🟢 | server move |
| R8.5.5 — self-status "I'm safe / hidden / barricaded" | 🚫 | P1 |
| R8.5.6 — silent by default on student device | 🟢 | already silent in v1 |
| R8.5.7 — reset (self or staff) | 🟢 | keep |

## §8.6 Location

| Req | Status | Note |
|---|---|---|
| R8.6.1 — off by default; only during incident or policy-tied threat | 🟢 | per [DECISIONS.md D3](DECISIONS.md): default `'on-activation'` |
| R8.6.2 — last-known → fresh-fix → watcher + background task | 🟢 | v1 strategy, keep |
| R8.6.3 — accuracy filter + path smoothing + "approximate / GPS pending" UI | 🟡 | filter + smoothing done; UI state vocabulary in [DESIGN.md](DESIGN.md) |
| R8.6.4 — indoor limitation disclosed; zone-level hints not implied precision | ⬜ | needs explicit UI copy |
| R8.6.5 — stops on reset/clear; "tracking active" indicator | 🟡 | stop logic exists; indicator needs design |
| R8.6.6 — permissions requested contextually with rationale | ⬜ | rationale screens needed |

## §8.7 AI

| Req | Status | Note |
|---|---|---|
| R8.7.1 — alert compression ≤12 words | 🟢 | move client → server |
| R8.7.2 — all-clear generation | 🟢 | move client → server |
| R8.7.3 — commander brief ≤22 words | 🟢 | move client → server |
| R8.7.4 — mass-broadcast polish grounded in snapshot | 🟢 | move client → server |
| R8.7.5 — area description from coords (geocoder + LLM phrasing) | ⬜ | per [DECISIONS.md D6](DECISIONS.md): use Geocoding API + Gemini phrasing |
| R8.7.6 — translation | 🚫 | P1 |
| R8.7.7 — guardrails (never invent, never auto-trigger, no 911, fallback, caps, log) | 🟡 | "never invent" + "no 911" already in v1 prompts; fallback chain + log are new |

## §8.8 Communication

| Req | Status | Note |
|---|---|---|
| R8.8.1 — staff↔guardian chat scoped to student/incident with role labels | 🟢 | server move + scope enforcement |
| R8.8.2 — mass broadcasts with audience targeting, RBAC-gated | 🟢 | server RBAC is new |
| R8.8.3 — immutable audit (retract/supersede in UI, never silently delete) | ⬜ | v1 deletes; v2 must not |
| R8.8.4 — templates + ack + translation | 🚫 | P1 |

## §8.9 Notifications

| Req | Status | Note |
|---|---|---|
| R8.9.1 — server push (APNs/FCM via Expo Push or direct) | ⬜ | replaces v1 local-only |
| R8.9.2 — critical/time-sensitive delivery for threat + beacon | ⬜ | per [DECISIONS.md D5](DECISIONS.md): time-sensitive only at launch |
| R8.9.3 — per-event types covered | ⬜ | mirror v1 taxonomy |
| R8.9.4 — minimized content, audience-scoped | ⬜ | |

## §8.10 Admin console (web)

| Req | Status | Note |
|---|---|---|
| R8.10.1 — org/campus creation + settings | ⬜ | |
| R8.10.2 — roster management + join codes + guardian-link approval | ⬜ | |
| R8.10.3 — zone editor with geo/coords (replaces v1's 4 hardcoded) | ⬜ | |
| R8.10.4 — branding (display name, logo, colors) | ⬜ | replaces "San Jose High" |
| R8.10.5 — policy config (who-declares, audiences, retention, location policy, language, 911-toggle default OFF) | ⬜ | |
| R8.10.6 — audit log viewer (read-only, exportable) | ⬜ | |
| R8.10.7 — analytics / scheduled drills | 🚫 | P1/P2 |

## §8.11 Accessibility & localization

| Req | Status | Note |
|---|---|---|
| R8.11.1 — WCAG 2.1 AA: contrast, screen-reader labels, dynamic type, focus order, non-hold trigger | ⬜ | covers R8.5.2 |
| R8.11.2 — no info by color alone | ⬜ | verification states need text + icon |
| R8.11.3 — localization / translation / RTL | 🚫 | P1/P2 |

---

## §10 Architecture work

| Item | Status | Note |
|---|---|---|
| Monorepo workspaces (`app/` `admin/` `server/` `shared/`) | 🟡 | scaffold this session |
| Split `App.tsx` into modules | ⬜ | step 7 — future session |
| Tokens in `expo-secure-store`, not AsyncStorage | ⬜ | step 2 |
| Config-driven UI (campus/zones/branding/roster/policy from backend) | ⬜ | step 7 |
| Authoritative backend mediates every write | 🟡 | Server foundation up (express + Firebase Admin SDK); auth routes live, incident/threat/messages routes in step 4. |
| Firestore + RTDB scoped by `campusId` with security rules | 🟡 | step 1 — rules + indexes + storage rules written in `server/firestore-rules/`; deploy gated on auth |
| AI proxy with KMS keys + provider-agnostic interface + fallback chain | ⬜ | step 5 |
| Server push dispatcher (APNs/FCM via Expo Push or direct) | ⬜ | step 6 |
| Offline client queue + server dedup by event id | 🟡 | v1 has client queue; dedup is new |
| Dev / staging / production project separation | ⬜ | provision dev only this round |

## §11 Compliance

| Item | Status | Note |
|---|---|---|
| FERPA-aware roster/incident handling + school-official provisioning | ⬜ | |
| COPPA path (parent-provisioned, verifiable consent) | 🚫 | P1 |
| Configurable retention per campus + auto-purge of LocationPoints | ⬜ | |
| Consent records (timestamp + scope) | ⬜ | |
| Immutable audit (actor + time + device) | ⬜ | |
| Data minimization (parents see linked child only; students never see others' locations) | 🟡 | enforced in v1 UI; rules now enforce at DB layer (parent reads gated by `linkedStudents` claim; students restricted to own incident/location) |
| Step-up auth / MFA for admin + threat actions | ⬜ | |
| Rate limits + abuse protection on AI proxy + auth | ⬜ | |

## §15 Store readiness

| Item | Status | Note |
|---|---|---|
| iOS permission/purpose strings (accurate, incident-scoped) | 🟡 | exist in v1, must remain accurate after refactor |
| Sign in with Apple registered (required on iOS) | ⬜ | |
| In-app account deletion path | ⬜ | |
| Privacy Nutrition Label + Data Safety form draft | ⬜ | |
| Critical Alerts entitlement | 🚫 | per [DECISIONS.md D5](DECISIONS.md): post-launch |
| Android background-location justification + demo video | ⬜ | |
| Foreground-service type: location declared | 🟢 | v1 declares |
| Public privacy policy + terms with "not a 911 substitute" disclaimer | ⬜ | |
| DPA template + security overview for procurement | ⬜ | |

---

## Scaffolding (this session)

| Item | Status |
|---|---|
| Create `v2` branch | ✅ |
| Save PRD.md | ✅ |
| PLAN.md, KEYS.md, DECISIONS.md, TODO.md, DESIGN.md, README.md | ✅ |
| npm workspaces + monorepo skeleton | ⬜ |
| Move v1 into `app/`; create `admin/`, `server/`, `shared/` stubs | ⬜ |
| 3 `.env.example` files | ⬜ |
| `zod` env schemas in `shared/` | ⬜ |
| Fail-loud env validator at boot (server) | ⬜ |
| Fail-loud env validator at boot (app) | ⬜ |
