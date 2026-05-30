# @beacon5/server

Authoritative backend for Beacon5 v2. Mediates every state change; clients never write to data they don't own.

**Status:** Phase 0 **step 2** (Supabase). Routes: `/healthz`, `/v1/auth/session | join | bootstrap | join-codes`. Step 3 wires RBAC for the rest of the surface. Step 4 adds incident routes, step 5 the AI proxy, step 6 push.

## First-time setup

You need to do this once per Supabase project (dev/staging/prod). See [KEYS.md §1](../KEYS.md#1-supabase-used-for-postgres--rls-auth-realtime-storage).

1. **Create the Supabase project** at supabase.com.
2. **Run the SQL migration** — Supabase dashboard → SQL Editor → paste [`supabase/migrations/001_init.sql`](../supabase/migrations/001_init.sql) → Run. Creates all tables, RLS policies, and helper functions. Idempotent.
3. **Enable auth providers** in the Supabase dashboard (Authentication → Providers):
   - Email — Magic Link (passwordless) is the lowest-friction default.
   - Google — paste in your Google OAuth Web Client ID + Secret ([KEYS.md §5.3](../KEYS.md)). Add `https://<project>.supabase.co/auth/v1/callback` to authorized redirect URIs in Google Cloud.
   - Apple — Services ID, Team ID, Key ID, `.p8` ([KEYS.md §4](../KEYS.md)). Requires Apple Developer Program.
4. **Copy `.env.example` → `.env`** and fill in:
   - `SUPABASE_URL` — Project URL
   - `SUPABASE_PUBLISHABLE_KEY` — `sb_publishable_*` from API Keys
   - `SUPABASE_SERVICE_ROLE_KEY` — **secret**, the `service_role` JWT
   - `SUPABASE_JWT_SECRET` — JWT Settings → Reveal
   - `GEMINI_API_KEY` — [KEYS.md §2](../KEYS.md)
5. **Install + run:**

```bash
cd server
npm install
npm run dev
```

You should see:

```
Beacon5 server running on http://localhost:4000
  NODE_ENV=development
  SUPABASE_URL=https://<project>.supabase.co
  routes:
    GET  /healthz
    POST /v1/auth/session    (Bearer Supabase JWT)
    POST /v1/auth/join       (Bearer + { code, displayName })
    POST /v1/auth/bootstrap  (Bearer + { orgName, campusName, displayName })
    POST /v1/auth/join-codes (Bearer + { role, expiresInHours? }) — staff/admin
```

## Test it end-to-end

You need a real Supabase user JWT to hit the auth routes.

### Get a JWT (email/password is simplest for testing)

In the Supabase dashboard → Authentication → Users → "Add user" with an email + password. Then:

```bash
SUPABASE_URL="$(grep ^SUPABASE_URL .env | cut -d= -f2)"
PUB_KEY="$(grep ^SUPABASE_PUBLISHABLE_KEY .env | cut -d= -f2)"

curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $PUB_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"yourpass"}' \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["access_token"])'
```

Or use the SignInScreen on the device — it produces a session whose access_token can be inspected via React DevTools / `supabase.auth.getSession()`.

### Bootstrap the first admin

```bash
TOKEN=...  # from above

curl -X POST http://localhost:4000/v1/auth/bootstrap \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"orgName":"Queen of Apostles","campusName":"Queen of Apostles School","displayName":"Principal"}'

# → 201 { uid, campusId, role: "admin", ... }
```

After this, the user's `auth.users.raw_app_meta_data` has `{ campus_id, role: "admin" }` set. The user must refresh their JWT to see the new claims:

```ts
await supabase.auth.refreshSession();
```

The app's `AuthContext` does this automatically after `/v1/auth/session` returns.

### Issue a join code (as admin)

```bash
curl -X POST http://localhost:4000/v1/auth/join-codes \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"role":"student","expiresInHours":72}'

# → 201 { code: "ABCD-EF12", role: "student", expiresAt: 174... }
```

### Redeem a join code (as a new user)

Sign in a different Supabase user, then:

```bash
curl -X POST http://localhost:4000/v1/auth/join \
  -H "Authorization: Bearer $NEW_USER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"code":"ABCD-EF12","displayName":"Maya"}'

# → 201 { uid, campusId, role: "student", ... }
```

### Resume an existing session

```bash
curl -X POST http://localhost:4000/v1/auth/session \
  -H "Authorization: Bearer $TOKEN"

# → 200 { uid, campusId, role, displayName, isMinor, linkedStudents? }
# → 404 NEEDS_JOIN  if the user has no campus membership yet
```

## What's enforced

| Layer | Where | How |
|---|---|---|
| Token verification | [`auth/verifyToken.ts`](src/auth/verifyToken.ts) | Local HS256 verify with `SUPABASE_JWT_SECRET` |
| Tenant isolation | RLS in `001_init.sql` | Every policy filters by `jwt_campus_id() = campus_id` |
| Role gates | [`rbac/permissions.ts`](src/rbac/permissions.ts) | PRD §8.2.2 matrix — `Permission` enum |
| Step-up auth | [`rbac/requireRole.ts`](src/rbac/requireRole.ts) | `iat` ≤ 5 minutes for STEP_UP_PERMISSIONS |
| Server-only writes | RLS + handlers | All writes via `admin` client (`service_role`); RLS denies anonymous writes |
| One campus per user | `users` table | `id` PK references `auth.users(id)` — at most one row per auth uid |
| Code redemption races | `joinCode.ts` | Update-with-conditions: `consumed_by is null and expires_at > now()` |

## What's next (won't run until later steps)

- **Step 3** — apply `requirePermission` to incident, threat, broadcast, roster routes
- **Step 4** — `/v1/incidents`, `/v1/threat/{declare,clear}`, `/v1/messages/{chat,mass}` with write validation
- **Step 5** — `/v1/ai/{clarify-alert,brief,all-clear,polish-broadcast}` with Gemini + fallback chain
- **Step 6** — APNs/FCM dispatcher
- **Step 12** — audit log writes + retention purge (pg_cron)

## Secret rotation schedule

| Item | Cadence |
|---|---|
| Supabase `service_role` key | quarterly + on any leak |
| Supabase JWT secret | on suspected leak (rotating logs everyone out) |
| Gemini API key | quarterly + on any leak |
| Expo access token | quarterly |
| Apple Sign-In `.p8` (4.4) | annually |
| APNs `.p8` (6.3) | annually |
| Google OAuth client secrets | on suspected leak |

Track rotations in your password manager, not in this repo.

## Tenant isolation rules

Every database read/write must filter by `campus_id`. Row Level Security in `supabase/migrations/001_init.sql` enforces this at the database via the `jwt_campus_id()` helper. The middleware in `src/rbac/` enforces this at request time via `req.user.app_metadata.campus_id`. **Both must pass** — defense in depth.
