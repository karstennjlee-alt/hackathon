# Beacon5 — Product Requirements Document (PRD)
Real-time campus & facility safety platform

| Field | Value |
|---|---|
| Product | Beacon5 |
| Document type | Production PRD (v2.0 — productionization of hackathon v1) |
| Status | Draft for review |
| Owner | Aadit Mehta, Karsten Lee |
| Last updated | May 29, 2026 |
| Platforms | iOS, Android (Expo / React Native), with a web admin console |
| Origin | 1st Place Overall — Synthesis Hacks |
| Source of truth | This document supersedes ad-hoc decisions in the v1 codebase |

**Safety disclaimer** (must appear in-product and in store listings): Beacon5 is a coordination and communication tool. It is not a replacement for 911 or professional emergency services, and it does not dispatch police, fire, or EMS. The product is designed to support trained human responders and school crisis plans, never to replace human judgment.

---

## 1. Executive summary

Beacon5 is a real-time safety platform for schools and other campus-style facilities. When a verified staff member declares a threat, the system arms across every device on that campus. Students can silently signal distress with one gesture and share live location; staff coordinate response from a single dashboard; parents and guardians receive trusted, official updates instead of rumors; administrators broadcast calm, AI-clarified messages to the right audiences.

The core thesis, taken directly from the founders' lived experience of a lockdown:

> Missing information + fear = chaos. Beacon5 turns fear into clarity, coordination, and safety.

The v1 hackathon build proves the concept end-to-end. This PRD defines what is required to take that proof into a production, App-Store-publishable, multi-tenant product.

---

## 2. Background & problem statement

### 2.1 The problem
During a campus emergency, the threat itself is rarely the only danger — the surrounding confusion is. Students don't know what is happening; staff can't see who needs help; parents rely on rumors; administrators coordinate through scattered channels with no shared real-time picture.

### 2.2 The opportunity
A single connected system that links students, staff, parents, and administrators in real time — with location, trusted communication, and AI that makes messages clearer under stress — measurably reduces the "information gap" that turns an incident into chaos.

### 2.3 Why now / why us
Schools already run lockdown drills and crisis plans but lack a real-time coordination layer that works on the devices everyone already carries. The founders experienced this gap firsthand during an actual lockdown and validated demand by winning a hackathon overall.

---

## 3. Goals & non-goals

### 3.1 Goals (v2 production)
- **Real identity & trust.** Replace demo roster selection with real, verifiable authentication and role assignment scoped to a verified organization.
- **Multi-tenancy.** Any school/organization can onboard, configure, and run Beacon5 independently with full data isolation.
- **Customization for anybody.** Zero hard-coded campus names, zones, rosters, passwords, or branding — all configurable by an admin.
- **Production reliability.** Real-time delivery, offline resilience, and predictable behavior at campus scale (thousands of concurrent devices).
- **Privacy & compliance by design.** FERPA/COPPA-aware data handling, data minimization, location-only-on-activation, and auditable access.
- **Store-publishable.** Meets Apple App Store and Google Play policy, permission, and review requirements.
- **Safety-first AI.** Clear, fast, factual AI assistance with strict guardrails that never invents facts and never overrides human responders.

### 3.2 Non-goals (out of scope for v2)
- Beacon5 does **not** call or dispatch 911/police/fire/EMS, and does not integrate with PSAP/CAD systems in v2.
- Beacon5 is **not** a weapons-detection, gunshot-detection, or surveillance/face-recognition system.
- Beacon5 does **not** provide medical diagnosis or instructions beyond routing a request for help to staff.
- **No** public/consumer self-signup outside of a verified organization in v2.

---

## 4. Target users & personas

| Persona | Role in product | Primary needs | What they must never be given |
|---|---|---|---|
| **Student (minor)** | Signals distress, shares location when armed, receives instructions | One-tap silent help, reassurance, clear next step | Surveillance when not in an incident; ability to see other students' locations |
| **Teacher / Staff** | Operates "Mission Control," verifies clusters, broadcasts to their room | A single live picture, fast verified-vs-unverified signal, easy broadcast | Ability to permanently delete audit logs; cross-campus data |
| **Parent / Guardian** | Linked to specific student(s), receives official updates, two-way chat | Trusted updates only, no rumors, contact with staff | Live location of the student outside an active incident; other families' data |
| **Administrator / Principal** | Declares/clears campus threats, sends mass broadcasts, manages org config | Authoritative control, audience-targeted messaging, configuration | Anything that bypasses audit/logging |
| **District / Org owner** (new) | Manages multiple campuses, billing, compliance settings | Multi-campus rollups, policy controls, SSO | — |

Accessibility personas are first-class: low-vision (screen reader, large type), motor-constrained (alternative to press-and-hold), non-English speakers (localization).

---

## 5. Product principles

1. **Designed for panic.** Every primary action is reachable in one or two taps with large targets, high contrast, and minimal reading. If a scared 12-year-old can't use it instantly, it's wrong.
2. **Less confusion = more safety.** Default to fewer options, clearer states, and one obvious next step.
3. **Location is sacred.** Continuous tracking is off by default and only active during an armed incident the user opted into.
4. **AI clarifies, never decides.** AI compresses and calms communication; it never invents facts, never triggers actions autonomously, and never replaces human responders.
5. **Trust is the product.** Verified identity, official-only updates to parents, and visible verification states exist to defeat rumor and misinformation.
6. **Fail safe and fail loud.** When connectivity or GPS degrades, the app degrades gracefully and tells the user the truth.

---

## 6. Current state (v1) — honest assessment

### 6.1 What v1 already does well
Three roles + admin; hold-to-activate beacon with haptics + SVG ring; escalation sheets (threat/medical) with preset chips + freeform notes; live location (foreground watch + last-known + fresh-fix race + background task + accuracy filtering + path smoothing); real-time sync via Firebase RTDB with offline queue; campus threat declaration that arms/disarms; verification model (pending → forming → verified → staff-confirmed); Gemini 2.5 Flash for alerts/briefs/all-clear/broadcast polish/geocoding with hard caps + never-invent guardrails; staff↔parent chat; audience-targeted mass broadcasts; local push with time-sensitive/critical handling; fleet/mini/campus maps; dark/light theme; glassmorphic UI; haptics throughout.

### 6.2 Critical gaps blocking production

| # | Gap (v1) | Risk | v2 requirement |
|---|---|---|---|
| **G1** | No real authentication — users pick from a hard-coded roster in AsyncStorage. | Anyone can impersonate any role. | Real auth + verified org membership + role assignment (§8.1). |
| **G2** | Secrets in the client bundle (`EXPO_PUBLIC_*`). | Key theft, quota abuse, billing exposure. | Server-side proxy; no model/provider keys on device (§10, §11). |
| **G3** | Hard-coded principal password (`'cwb'`) gates campus-threat. | Trivially bypassed; not per-org. | Server-enforced RBAC + step-up auth (§8.4). |
| **G4** | Single shared global event log (`beacon5/events`). | No tenant isolation. | Multi-tenant data model with isolation + security rules (§10, §11). |
| **G5** | Hard-coded campus, zones, rosters. | Not usable by any other school. | Full configuration layer (§9). |
| **G6** | No privacy/compliance controls. | Unacceptable for minors. | Compliance program (§11). |
| **G7** | No server-side validation. | Clients are trusted; events can be forged. | Authoritative backend + validation (§10). |
| **G8** | Monolithic 6,000-line single file with seed data in runtime. | Unmaintainable. | Modular architecture (§10, §13). |
| **G9** | Notifications are local-only. | Alerts missed when app is killed. | Server push (APNs/FCM) (§8.9). |
| **G10** | No accessibility or localization guarantees. | Excludes users. | WCAG-aligned a11y + i18n (§8.11). |

---

## 7. Scope overview & prioritization

P0 = launch blocker. P1 = fast-follow. P2 = later.

| Area | P0 | P1 | P2 |
|---|---|---|---|
| Auth & identity | Real auth, org-scoped roles, guardian linking, SSO-ready | Roster import (SIS/CSV), MFA for admins | District SSO federation, badge/NFC sign-in |
| Authorization (RBAC) | Server-enforced role permissions, step-up for admin actions | Custom roles | Fine-grained per-zone delegation |
| Multi-tenancy | Org/campus model, data isolation | District → multi-campus rollups | Cross-district mutual-aid mode |
| Beacon & escalation | Hold-to-activate, threat/medical escalation, accessible alt-trigger | Status types config, "I'm safe" check-in | Wearable/Apple Watch trigger |
| Location & tracking | On-activation GPS, background tracking, accuracy handling | Indoor zone hints, geofence arming | BLE beacons / indoor positioning |
| Communication | Staff↔parent chat, mass broadcasts, audience targeting | Templates, read receipts, translation | Voice/PA integration |
| AI layer | Server-proxied alerts/briefs/broadcast polish + guardrails | Multilingual output, summarization of incident | On-device fallback model |
| Notifications | Server push (APNs/FCM), critical alerts | Per-role channels, quiet-hours override | SMS/email fallback |
| Admin console (web) | Org config, roster, zones, branding, audit log | Drill mode, analytics dashboard | Scheduled drills, reporting exports |
| Compliance & privacy | Consent, retention, deletion, audit, data minimization | DPA tooling, regional data residency | SOC 2 / formal certifications |
| Reliability / offline | Offline queue, graceful degradation | Multi-region failover | Edge caching |
| Accessibility & i18n | WCAG 2.1 AA targets, alt-trigger, dynamic type | Full localization (top languages) | RTL, voice control |

---

## 8. Functional requirements

### 8.1 Authentication & identity (P0)

- **R8.1.1** Users authenticate against a real identity provider: email + password with verification, or magic-link/OTP, **and** Sign in with Apple + Google sign-in (Apple mandatory on iOS if any social login is offered).
- **R8.1.2** Every account is bound to exactly one verified organization (campus) at a time and a role within it. Roles are assigned by an admin or via verified roster import — never self-selected.
- **R8.1.3** Join flow is invitation/verification-gated: org-issued join code (per-role, expiring), domain-verified email, and/or roster match (SIS/CSV).
- **R8.1.4** Guardian linking is verified, not self-asserted (admin/roster-provisioned, one-time student-specific guardian code, or admin approval).
- **R8.1.5** Session management: tokens in Keychain/Keystore (`expo-secure-store`), refresh tokens, server-side revocation, remote sign-out.
- **R8.1.6** Account recovery cannot hijack a role-bearing identity (admin-mediated for staff/admin).
- **R8.1.7** Minor handling: student accounts flagged; FERPA "school official" provisioning path supported.
- **R8.1.8** (P1) MFA for admin/principal. (P1) SIS/CSV import. (P2) District SSO (SAML/OIDC) + SCIM.

### 8.2 Authorization / RBAC (P0)

- **R8.2.1** Permissions enforced server-side, never only in client.
- **R8.2.2** Baseline permission matrix:

| Capability | Student | Parent | Staff | Admin/Principal |
|---|---|---|---|---|
| Activate personal beacon | ✅ | — | ✅ (own) | ✅ (own) |
| View own location/incident | ✅ | linked child only | ✅ | ✅ |
| View campus fleet map | — | — | ✅ | ✅ |
| Verify / confirm a cluster | — | — | ✅ | ✅ |
| Chat with staff | ✅ | ✅ (re: child) | ✅ | ✅ |
| Send mass broadcast | — | — | ✅ (scoped) | ✅ (all audiences) |
| Declare / clear campus threat | — | — | ✅ (configurable) | ✅ |
| Mark all-clear / end incident | — | — | ✅ | ✅ |
| Manage org config / roster | — | — | — | ✅ |
| View audit log | — | — | partial | ✅ |

- **R8.2.3** Step-up auth (recent re-auth or MFA) for declare/clear threat, mass broadcast to "everyone," roster changes. Replaces hard-coded `'cwb'`.
- **R8.2.4** Whether "any staff" or "admin only" can declare a campus threat is org-configurable.

### 8.3 Multi-tenancy & org model (P0)

- **R8.3.1** Top-level entities: **Organization (District) → Campus → Users / Zones / Incidents / Messages**.
- **R8.3.2** Hard data isolation between campuses. All reads/writes scoped by `campusId` and enforced server-side and in DB security rules. Removes v1's global `beacon5/events` path.
- **R8.3.3** Each campus has independent configuration, branding, rosters, zones, retention, audit log.
- **R8.3.4** (P1) District rollup views. (P2) cross-campus "mutual aid" mode.

### 8.4 Campus threat declaration & arming (P0)

- **R8.4.1** Authorized user (per R8.2.4 policy) declares campus threat → arms all campus devices.
- **R8.4.2** Declare/clear require step-up auth and are fully audited.
- **R8.4.3** All-clear disarms campus, stops active tracking, sends AI-assisted calm all-clear.
- **R8.4.4** (P1) Drill mode — explicitly labeled, non-emergency, marked "DRILL" everywhere.
- **R8.4.5** Misfire protection: confirm-to-declare, fast clear, auto-prompt to confirm/extend.

### 8.5 Student beacon & escalation (P0)

- **R8.5.1** Hold-to-activate beacon (1s + haptics + ring).
- **R8.5.2** **Accessible alternative trigger** (new P0): tap-confirm or assistive-touch path. Press-and-hold cannot be the only path to help.
- **R8.5.3** On activation: create incident, begin location capture, notify staff (+ linked guardians per policy).
- **R8.5.4** Escalation detail: preset chips (weapon seen, loud bangs, forced entry, smoke/fire, bleeding, unconscious, breathing difficulty, allergic reaction) + freeform note → AI-clarified.
- **R8.5.5** (P1) "I'm safe / hidden / barricaded" self-status.
- **R8.5.6** **Silent by default** on student device during a threat: haptic-only confirmation.
- **R8.5.7** Reset / "I'm okay" — student or staff can reset.

### 8.6 Location & live tracking (P0)

- **R8.6.1** **Off by default.** Captured only during an armed incident the user activated (or a campus threat tied by policy). Reflected in copy, permission strings, UI.
- **R8.6.2** Retain v1 acquisition: last-known fix immediately, fresh fix raced against timeout, foreground watcher; background via foreground-service task with user-facing notification.
- **R8.6.3** Accuracy handling: keep accept/reject filter and smoothing; always show accuracy radius + "approximate / GPS pending."
- **R8.6.4** Indoor limitation is disclosed; zone-level hints, not implied meter-level precision. (P2) BLE / indoor positioning.
- **R8.6.5** Stops on reset/all-clear; visible "tracking active" indicator whenever on.
- **R8.6.6** Permissions requested contextually with rationale screens.

### 8.7 AI layer (P0)

All AI server-side. AI is assistive and constrained.

- **R8.7.1** Alert compression: raw note → calm, factual ≤12-word lock-screen alert, leading with first name.
- **R8.7.2** All-clear generation: calm 2-sentence official message.
- **R8.7.3** Staff commander brief: ≤22-word sentence with who/where/next step.
- **R8.7.4** Mass-broadcast polish: rewrite draft grounded only in live situation snapshot.
- **R8.7.5** Area description: plain-language description of coords, hedged when uncertain.
- **R8.7.6** (P1) Translation for parent updates.
- **R8.7.7** **Guardrails (hard requirements):**
  - Never invent facts, names, weapons, locations, instructions not in input.
  - Never autonomously trigger any action.
  - Never mention 911/police/EMS (org-configurable, default off).
  - Deterministic template fallback when AI slow/unavailable/low-confidence.
  - Length caps enforced in code.
  - All incident AI I/O logged for audit.

### 8.8 Communication (P0)

- **R8.8.1** Staff ↔ guardian chat scoped to student/incident, with sender role labels.
- **R8.8.2** Mass broadcasts with audience targeting (students/parents/teachers/everyone), campus-scoped, RBAC-gated.
- **R8.8.3** Broadcasts and chats immutable in audit log (retract/supersede in UI, never silently delete).
- **R8.8.4** (P1) Templates, read receipts/acknowledgement, translation.

### 8.9 Notifications (P0)

- **R8.9.1** Server-driven push (APNs/FCM, via Expo Push or direct).
- **R8.9.2** Critical/time-sensitive delivery for threat declared + beacon activated.
- **R8.9.3** Event types: threat declared/cleared, beacon activated, incident notes, broadcasts, mass broadcasts, chats.
- **R8.9.4** Notification content minimized, audience-scoped.

### 8.10 Admin console (web) (P0)

- **R8.10.1** Org/campus creation and settings.
- **R8.10.2** Roster management — add/import/verify, assign roles, issue join codes, approve guardian links.
- **R8.10.3** Zone editor — define zones/buildings/rooms, optionally with map coords/geofences.
- **R8.10.4** Branding — display name, logo, colors, header campus name.
- **R8.10.5** Policy config — who can declare threats, default audiences, retention windows, location policy, language, 911-mention toggle (default off).
- **R8.10.6** Audit log viewer (read-only, exportable).
- **R8.10.7** (P1) Analytics dashboard. (P2) Scheduled drills + reporting exports.

### 8.11 Accessibility & localization (P0 baseline)

- **R8.11.1** WCAG 2.1 AA: contrast, screen-reader labels everywhere, dynamic type, focus order, non-hold trigger.
- **R8.11.2** No information conveyed by color alone.
- **R8.11.3** (P1) Localization of all UI strings; (P1) AI output translation; (P2) RTL.

---

## 9. AI model strategy

### 9.1 Principles
Latency-critical, safety-critical, assistive-only. Sub-second perceptible delay. Never blocks safety flow. Never fabricates. Never acts autonomously.

### 9.2 Model selection

| Use case | Latency need | Recommended tier | Notes |
|---|---|---|---|
| Alert compression (≤12 words) | Very low | Fast/flash-class (v1: Gemini 2.5 Flash) | Hot path |
| Staff commander brief | Low | Fast/flash-class | Single sentence |
| All-clear & mass-broadcast polish | Low–medium | Fast/flash-class, higher-quality optional | Quality > speed |
| Area description from coords | Low | Geocoding API + LLM phrasing | Geocoder more accurate than LLM alone |
| Translation (P1) | Low | Fast multilingual / translation API | Parent-facing |

- **R9.2.1** Primary model: Gemini 2.5 Flash (or current flash successor). Model name in server config, not client.
- **R9.2.2** Provider-agnostic interface so model/provider can swap or A/B without client changes.
- **R9.2.3** Fallback chain: primary → secondary → deterministic template.
- **R9.2.4** (P2) Evaluate on-device small model for last-resort offline phrasing.

### 9.3 Prompt & safety engineering
Task-specific system prompts with explicit constraints. Hard caps in code independent of model. Grounding context for broadcast polish. Low temperature (0.4). Abort/timeout on every call. Minimal PII to model. Incident AI I/O logged per retention.

### 9.4 What AI must never do
Declare/clear a threat; send a broadcast; dispatch help; identify a specific real person as a threat; give medical instructions; claim certainty about location it doesn't have.

---

## 10. Technical architecture

### 10.1 High-level

```
 ┌──────────────────────────┐         ┌─────────────────────────────┐
 │  Mobile app (Expo/RN/TS) │         │   Admin console (web)        │
 │  iOS · Android           │         │   org/roster/zones/branding  │
 └──────────┬───────────────┘         └──────────────┬───────────────┘
            │  HTTPS (auth'd, token)                  │
            ▼                                          ▼
 ┌───────────────────────────────────────────────────────────────────┐
 │                  Backend API (authoritative)                       │
 │  • AuthN/AuthZ (RBAC, step-up)   • Incident & event service        │
 │  • AI proxy (keys server-side)   • Notification dispatch (APNs/FCM)│
 │  • Org/config service            • Audit & compliance service      │
 │  • Validation of every write     • Tenant isolation (campusId)     │
 └───────────────┬───────────────────────────────┬─────────────────────┘
                 ▼                                 ▼
   ┌──────────────────────────┐      ┌──────────────────────────────┐
   │  Realtime layer          │      │  Persistent store + secrets  │
   │  (Firestore + RTDB or    │      │  (DB, KMS-held keys, audit,  │
   │   managed websockets)    │      │   blob storage)              │
   └──────────────────────────┘      └──────────────────────────────┘
```

### 10.2 Frontend
- Expo + React Native + TypeScript. EAS Build/Submit pipeline.
- Refactor monolith into `auth/`, `incident/`, `location/`, `comms/`, `maps/`, `ai/` (client → proxy only), `ui/`, typed event/domain layer.
- Remove all seed/demo constants from runtime code; demo data behind explicit flag only.
- Tokens in `expo-secure-store`, not AsyncStorage.
- Config-driven UI: campus name, zones, branding, roster, policy come from backend.
- Retain: `expo-location`, `expo-task-manager`, `expo-notifications`, `expo-haptics`, `react-native-maps`, `react-native-svg`, `expo-blur`/`expo-linear-gradient`, `lucide-react-native`.

### 10.3 Backend
- Authoritative backend mediates every state change.
- Realtime: Firestore (structured/queryable) + RTDB (low-latency presence/live) behind security rules + server validation, scoped by `campusId`.
- AI proxy: holds provider keys in KMS, applies prompt templates and caps. Client never sees a model key.
- Notification service: server-side dispatch via Expo Push or direct APNs/FCM with audience scoping and critical-alert handling.
- Offline: client queue/retry; server dedupes by event id.

### 10.4 Environments
Separate dev / staging / production projects and credentials. No production secrets in any repo. Rotate any key historically committed.

---

## 11. Security, privacy & compliance

### 11.1 Regulatory scope
FERPA (US student records), COPPA (US under-13), state student-privacy laws + DPAs, GDPR/region (P2 outside US).

### 11.2 Core privacy guarantees
- Location only during active, user-initiated incident (or policy-tied campus threat).
- Data minimization: parents see only linked child; students never see others' locations.
- Retention & deletion: configurable windows per campus; auto-purge of incident location traces.
- Consent records: store with timestamp and scope.
- Audit: every high-impact action immutably logged with actor, time, device.

### 11.3 Application security
Server-enforced RBAC and tenant isolation. No secrets on device. Step-up auth/MFA for admin and threat actions. TLS + at-rest encryption + KMS + dep scanning + least-privilege service accounts. DB security rules scope by `campusId` and role; remove open global path. Rate limits + abuse protection on AI proxy + auth.

### 11.4 Trust & safety content
AI guardrails (§8.7.7, §9.4). Clear in-app statement: Beacon5 supports — never replaces — 911 and the school's crisis plan.

---

## 12. Data model (illustrative)

```
Organization { id, name, type, settings, createdAt }
Campus       { id, orgId, name, branding{ displayName, logoUrl, colors },
               policy{ whoCanDeclareThreat, defaultAudiences, locationPolicy,
                       retentionDays, languages, allow911Mention=false },
               createdAt }
User         { id, campusId, role[student|parent|staff|admin], status,
               authProviderId, isMinor, displayName, createdAt }
GuardianLink { id, campusId, guardianUserId, studentUserId, verified, createdAt }
Zone         { id, campusId, title, building, room, geo{lat,lng,radius?}, mapXY? }
CampusThreat { id, campusId, status[active|cleared], actorUserId, at }
Incident     { id, campusId, studentUserId, status, activatedAt, clearedAt,
               escalation{ kind, presets[], rawNote, clarifiedNote },
               lastKnownCoords{lat,lng,accuracy}, zoneHint }
LocationPoint{ id, campusId, incidentId, studentUserId, coords, accuracy, at }
Message      { id, campusId, kind[chat|broadcast|mass], senderUserId, senderRole,
               audience, studentUserId?, body, clarifiedBody?, at }
Notification { id, campusId, toUserId, type, payload, deliveredAt }
AuditEvent   { id, campusId, actorUserId, action, target, metadata, at }
ConsentRecord{ id, campusId, userId, type, scope, grantedBy, at }
Device       { id, userId, pushToken, platform, lastSeenAt }
```

v1's event types map cleanly: `BEACON_ACTIVATED`/`BEACON_RESET` → Incident, `LOCATION_UPDATE` → LocationPoint, `INCIDENT_NOTE`/`STAFF_BROADCAST`/`CHAT_MESSAGE`/`MASS_BROADCAST` → Message, `CAMPUS_THREAT` → CampusThreat — now tenant-scoped and server-validated.

---

## 13. API surface (representative, all auth'd & campus-scoped)

```
POST  /v1/auth/login | /v1/auth/social | /v1/auth/refresh | /v1/auth/logout
POST  /v1/orgs            (owner)            GET /v1/orgs/:id
POST  /v1/campuses        (owner/admin)      PATCH /v1/campuses/:id/settings
POST  /v1/roster/import   (admin)            POST /v1/joincodes (admin)
POST  /v1/guardian-links  (verify/approve)
POST  /v1/threat/declare  (step-up)          POST /v1/threat/clear (step-up)
POST  /v1/incidents       (student activate) POST /v1/incidents/:id/reset
POST  /v1/incidents/:id/escalate
POST  /v1/incidents/:id/location             (background task posts here)
GET   /v1/incidents?active=true              (staff fleet, campus-scoped)
POST  /v1/messages/chat | /v1/messages/mass  (RBAC-checked audience)
POST  /v1/ai/clarify-alert | /ai/brief | /ai/all-clear | /ai/polish-broadcast
GET   /v1/audit            (admin, read-only, exportable)
   ── realtime: subscribe to campus incident/message/threat streams (scoped) ──
```

All AI endpoints server-side with keys in KMS. Client sends only raw note/draft + context references.

---

## 14. Non-functional requirements

| Category | Requirement |
|---|---|
| Latency | Alert/clarify round-trip < 1.5s p95 (template fallback if exceeded). Realtime fan-out < 2s p95. |
| Reliability | Core arm/activate/notify resilient to AI outage, geocoder outage, intermittent connectivity. Target 99.9% uptime on realtime + push. |
| Scale | 3,000+ concurrent devices per campus; many campuses per region; zero cross-tenant interference. |
| Battery | Background tracking only during incidents. |
| Security | Pen-test before GA; no secrets on device; immutable audit. |
| Accessibility | WCAG 2.1 AA; non-hold trigger; dynamic type; screen-reader complete. |
| Observability | Crash reporting (Sentry), delivery metrics, AI fallback rate, incident timelines. |

---

## 15. App Store & Google Play readiness

### 15.1 Apple App Store
- Accurate permission/purpose strings for location (when-in-use + background) and notifications, incident-scoped.
- Sign in with Apple required if Google/social login offered.
- Account deletion in-app (route role-bearing through admin mediation, but path exists).
- Privacy Nutrition Label + policy URL.
- Critical Alerts entitlement (optional) requires Apple approval; default to time-sensitive.
- TestFlight before release.

### 15.2 Google Play
- Background location declaration with mandatory in-review justification + demo video.
- Foreground-service type: location.
- Data safety form matching policy.
- High-importance channels for emergency alerts.
- Target current API level; closed/internal testing track first.

### 15.3 Both
- Public privacy policy + terms with "not a substitute for 911" disclaimer.
- DPA template for schools; security overview for procurement.

---

## 16. Customization & white-label

Everything a new org needs, with zero code changes:

- Org self-serve onboarding via admin console.
- Configurable instead of hard-coded: campus name, zones, rosters, threat-declaration policy, audiences, retention, languages, 911-mention toggle.
- Beyond schools: same model for warehouses, hospitals, offices, construction sites. "Student/Teacher/Parent/Admin" generalize to "Member/Responder/Contact/Admin." Role labels themable per org type.
- Theming honors dark/light + brand colors.
- Optional modules toggled per org (chat, guardian linking, drill mode, indoor add-on).

---

## 17. Success metrics

| Goal | Metric |
|---|---|
| Adoption | # campuses onboarded; activation rate; MAU by role |
| Reliability | Alert delivery success %, push latency, AI fallback rate, crash-free sessions |
| Effectiveness (drills) | Time declare → first staff ack; % students who set status; broadcast read/ack rate |
| Trust | Parent update open rate; "felt informed" survey score; confusion tickets |
| Safety hygiene | False-activation rate, time-to-clear, stale-armed incidence (→ zero) |
| Privacy | % incidents with location auto-purged; zero cross-tenant events |

Measured in drills + normal operation, never by encouraging real emergencies.

---

## 18. Phased roadmap

- **Phase 0 — Productionize the core (P0).** Real auth + RBAC + multi-tenancy; server backend + AI proxy; tenant-isolated data + security rules; server push; config-driven UI + admin console; privacy/consent/retention/audit; accessibility baseline; store-submission readiness. Refactor monolith; remove seed.
- **Phase 1 — Hardening & reach (P1).** SIS/CSV roster import; admin MFA; templates + ack + translation; localization; drill mode + analytics; district rollups; read receipts.
- **Phase 2 — Differentiation (P2).** Indoor positioning / BLE; on-device fallback; wearables; cross-campus mutual-aid; data residency; SOC 2; PA/notification integrations. Any 911/PSAP integration is separately-scoped compliance work, out of near-term plan.

---

## 19. Risks & mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Privacy/legal exposure (minors' data, location) | High | Compliance program §11, data minimization, DPAs, legal review |
| False alarms / misuse | High | Confirm-to-declare, rate limits, audit, fast clear, admin visibility |
| Indoor GPS inaccuracy misleads responders | High | Always show accuracy + "approximate"; roadmap indoor positioning |
| Over-reliance — treating Beacon5 as 911 replacement | High | Prominent disclaimers, AI never mentions/handles dispatch |
| AI hallucination in an alert | Medium | Hard caps, "never invent," grounding, deterministic fallback, human-in-loop |
| Notification not delivered (app killed/DND) | Medium | Server push + critical/time-sensitive; ack tracking |
| Single-vendor (Firebase/Gemini) lock-in/outage | Medium | Provider-agnostic AI; fallback chain; evaluate multi-region |
| Founder bandwidth vs. enterprise sales/compliance | Medium | Phase the work; pilot schools; managed services |

---

## 20. Open questions

1. Single-campus self-serve first, or district-led sales first?
2. Who provisions student accounts — school (FERPA "school official") or parents (COPPA consent)? Likely both, configurable.
3. Default location policy: track only on personal activation, or also on campus-threat declaration?
4. Is "any staff can declare a threat" the right default, or admin-only with staff escalation?
5. Critical Alerts entitlement — pursue Apple approval, or ship with time-sensitive only at launch?
6. Replace LLM area-description with reverse-geocoding API for accuracy?

See [DECISIONS.md](DECISIONS.md) for sensible defaults applied while these remain open.

---

## 21. Appendix — v1 → v2 traceability

| v1 capability | v2 disposition |
|---|---|
| Roster picker onboarding | Replaced by verified auth + org-scoped roles (§8.1) |
| AsyncStorage profile | Replaced by secure tokens + server identity (§8.1.5) |
| Hard-coded `PRINCIPAL_PASSWORD='cwb'` | Replaced by RBAC + step-up auth (§8.2.3) |
| Global `beacon5/events` path | Replaced by tenant-scoped, validated data model (§10, §12) |
| `EXPO_PUBLIC_*` keys in bundle | Replaced by server-side AI proxy + KMS (§10.3, §11.3) |
| Hold-to-activate beacon | Kept + accessible alt trigger (§8.5.2) |
| Threat/medical escalation sheets | Kept, AI-clarified server-side (§8.5.4, §8.7) |
| Foreground + background location | Kept, privacy-scoped + disclosed (§8.6) |
| Verification states | Kept, surfaced accessibly (§8.5.5, §8.11.2) |
| Gemini 2.5 Flash alerts/briefs/broadcasts | Kept server-side, provider-agnostic, fallback chain (§9) |
| Staff/parent chat & mass broadcasts | Kept, RBAC-scoped, immutable log (§8.8) |
| Local notifications | Upgraded to server push (§8.9) |
| Dark/light theming | Kept + brandable per org (§16) |
| Fleet/mini/campus maps | Kept, zones now configurable (§8.10.3) |
| Single 6,000-line `App.tsx` + seed data | Refactored into modules; demo gated (§10.2) |

**End of document.**
