# @beacon5/server

Authoritative backend for Beacon5 v2. Mediates every state change; clients never write to a global path.

**Status:** Phase 0 **step 2** — auth foundation. Routes: `/healthz`, `/v1/auth/session | join | bootstrap | join-codes`. Phase 0 step 3 wires RBAC for the rest of the surface. Step 4 adds incident routes, step 5 the AI proxy, step 6 push.

## First-time setup

You need to do these once per Firebase project (dev/staging/prod). See [KEYS.md §1](../KEYS.md#1-firebase-used-for-realtime-auth-claims-via-admin-sdk-push-via-fcm) for screenshots/details.

1. **Download the service account JSON.** Firebase console → ⚙ Project settings → Service accounts → *Generate new private key*. Save it to `server/secrets/firebase-service-account.json` (the path is gitignored).
2. **Enable Firebase Auth providers** in the console for the providers you plan to use:
   - **Email link (passwordless)** — easiest, zero extra credentials. Enable this first for testing.
   - Sign in with Apple (needs Apple Developer signup — [KEYS.md §4](../KEYS.md#4-sign-in-with-apple-server-verification-of-apple-identity-tokens))
   - Google (needs OAuth client IDs — [KEYS.md §5](../KEYS.md#5-google-oauth-google-sign-in))
3. **Copy `.env.example` → `.env`** and fill in `FIREBASE_PROJECT_ID`, `GEMINI_API_KEY`, `FIREBASE_SERVICE_ACCOUNT_PATH`. The env validator throws at boot if any required var is missing.
4. **Install deps + run:**

```bash
cd server
npm install
npm run dev
```

You should see:

```
Beacon5 server running on http://localhost:4000
  NODE_ENV=development
  FIREBASE_PROJECT_ID=beacon5-7981f
  routes:
    GET  /healthz
    POST /v1/auth/session    (Bearer Firebase ID token)
    POST /v1/auth/join       (Bearer + { code, displayName })
    POST /v1/auth/bootstrap  (Bearer + { orgName, campusName, displayName })
    POST /v1/auth/join-codes (Bearer + { role, expiresInHours? }) — staff/admin
```

## Test it end-to-end

You need a real Firebase ID token to hit the auth routes. Easiest path during dev: sign in a test user from a tiny HTML page or use the Firebase Auth REST API.

### Quick: get an ID token via REST API

```bash
# 1. enable Email/Password sign-in in Firebase console
# 2. create a test user in the console (Authentication → Users → Add user)
# 3. exchange the email+password for an ID token:

API_KEY="$(grep EXPO_PUBLIC_FIREBASE_API_KEY ../app/.env | cut -d= -f2)"
RESP=$(curl -s -X POST \
  "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=$API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","password":"yourpass","returnSecureToken":true}')
TOKEN=$(echo "$RESP" | python3 -c 'import json,sys;print(json.load(sys.stdin)["idToken"])')
echo "$TOKEN"
```

### Bootstrap the first admin

```bash
curl -X POST http://localhost:4000/v1/auth/bootstrap \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"orgName":"Queen of Apostles","campusName":"Queen of Apostles School","displayName":"Principal"}'

# → 201 { uid, campusId, role: "admin", ... }
```

### Refresh your token (claims won't show until refresh)

After custom claims are set server-side, the **client must refresh its ID token** to receive them. In Firebase JS:

```js
await firebase.auth().currentUser.getIdToken(true); // force refresh
```

### Issue a join code (as admin)

```bash
curl -X POST http://localhost:4000/v1/auth/join-codes \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"role":"student","expiresInHours":72}'

# → 201 { code: "ABCD-EF12", role: "student", expiresAt: 174... }
```

### Redeem a join code (as a new user)

Sign in a different Firebase user, then:

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
| Token verification | [`auth/verifyToken.ts`](src/auth/verifyToken.ts) | `auth.verifyIdToken()` with revocation check |
| Tenant isolation | DB rules + token claims | `auth.token.campusId` → forwarded to Firestore/RTDB rules |
| Role gates | [`rbac/permissions.ts`](src/rbac/permissions.ts) | PRD §8.2.2 matrix — encoded as `Permission` enum |
| Step-up auth | [`rbac/requireRole.ts`](src/rbac/requireRole.ts) | `auth_time` ≤ 5 minutes for declare/clear, mass-everyone, roster |
| Server-only writes | rules + handlers | All DB writes go through Admin SDK; rule says `allow write: if false` for clients |
| One campus per user | join/bootstrap handlers | `collectionGroup('users').where('id','==',uid)` checked before insert |
| Code redemption races | `joinCode.ts` | Firestore transaction re-reads the code inside `runTransaction` |

## What's next (won't run until later steps)

- **Step 3** — apply `requirePermission` to the soon-to-exist incident, threat, broadcast, roster routes
- **Step 4** — `/v1/incidents`, `/v1/threat/{declare,clear}`, `/v1/messages/{chat,mass}` with write validation
- **Step 5** — `/v1/ai/{clarify-alert,brief,all-clear,polish-broadcast}` with Gemini + fallback chain
- **Step 6** — APNs/FCM dispatcher
- **Step 12** — audit log writes + retention purge

## Secret rotation schedule

| Item | Cadence |
|---|---|
| Gemini API key | quarterly + on any leak |
| Expo access token | quarterly |
| Apple Sign-In `.p8` ([KEYS.md §4.4](../KEYS.md#4-sign-in-with-apple-server-verification-of-apple-identity-tokens)) | annually |
| APNs `.p8` ([KEYS.md §6.3](../KEYS.md#6-apns-apple-push-mobile-app)) | annually |
| Firebase service account | on staff turnover |
| Google OAuth client secrets | on suspected leak |

Track rotations in your password manager, not in this repo.

## Tenant isolation rules

Every Firestore read/write must filter by `campusId`. The middleware in `src/rbac/` enforces this at request time; the rules in `firestore-rules/` enforce it at the database. **Both must pass** — defense in depth.
