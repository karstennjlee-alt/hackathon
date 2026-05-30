# Beacon5 v2 — Keys & Credentials Acquisition Guide

**You should be able to fill every blank in every `.env.example` using only this file, with zero guessing.**

This guide is the authoritative answer to "where does this key come from and which side does it live on." If a key you find in the wild isn't in this table, add it here with all five details before using it.

---

## Ground rules (read first)

1. **Client-safe vs server-only.** Every variable in this codebase is one or the other. Mixing them is the most common production security incident in mobile apps.
   - **Client-safe** (`EXPO_PUBLIC_*` in app, `VITE_*` in admin): bundled into the JS shipped to users. Assume the world will see it. Must be **scoped/restricted** by bundle ID, SHA-1, or HTTP referer.
   - **Server-only**: held in `server/.env` for local dev, in your KMS/secrets manager in prod. **Must never** appear in any `EXPO_PUBLIC_*` or `VITE_*` var, in `app/`, in `admin/`, or in `shared/`.
2. **Three environments.** Provision separate Firebase projects + separate keys for **dev**, **staging**, **production**. Never use a prod key locally.
3. **Never commit a real `.env`.** `.gitignore` blocks them. If a real secret ever lands in git history, **rotate immediately** — git filter-repo doesn't help once it's pushed.
4. **Fail loud.** The startup env validator (`src/env.ts` in both `app/` and `server/`) throws if any required var is missing, naming the var, the file, and the section of this doc.
5. **Cost expectations for the founder.** Most of these are free for development. Notable cost items: Apple Developer Program ($99/yr — required for App Store + APNs + Sign in with Apple), Google Cloud billing account (free credit covers the early going, but billing must be enabled to issue keys), and the first scaled Firebase usage. Provision dev first; staging + prod can wait until pilots.

---

## Master key table

Each row = one var. Columns: **what it is**, **var name**, **where to get it**, **server vs client**, **how to restrict**.

### 1. Firebase (used for: realtime, auth claims via admin SDK, push via FCM)

You need **three separate Firebase projects**: `beacon5-dev`, `beacon5-staging`, `beacon5-prod`. Each yields one set of values. The `.env` files below are for dev; copy-paste the pattern for staging/prod into your CI/CD secret store.

| # | Var | Side | Where to get it | Restrict by |
|---|---|---|---|---|
| 1.1 | `FIREBASE_PROJECT_ID` | server | Firebase console → ⚙ Project settings → General → Project ID | n/a (identifier) |
| 1.2 | `FIREBASE_SERVICE_ACCOUNT_PATH` *(file path)* or `FIREBASE_SERVICE_ACCOUNT_JSON` *(inline JSON, base64-OK)* | **server only** | Firebase console → ⚙ Project settings → Service accounts → "Generate new private key" → downloads a JSON file. Save to `server/secrets/firebase-service-account.json` (gitignored). | IAM role on the service account — give it only `Firebase Admin SDK Administrator Service Agent` for dev; tighten in prod. |
| 1.3 | `EXPO_PUBLIC_FIREBASE_API_KEY` | **client-safe** | Firebase console → ⚙ Project settings → General → "Your apps" → register an iOS + an Android app → SDK setup → web config object | Google Cloud console → APIs & Services → Credentials → click the key → "Application restrictions" → restrict by **iOS bundle ID** + **Android package + SHA-1**. |
| 1.4 | `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN` | client-safe | same web config | n/a (domain) |
| 1.5 | `EXPO_PUBLIC_FIREBASE_PROJECT_ID` | client-safe | same | n/a |
| 1.6 | `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET` | client-safe | same | Firebase Storage rules (R8.3.2 — scope by `campusId`) |
| 1.7 | `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | client-safe | same | n/a |
| 1.8 | `EXPO_PUBLIC_FIREBASE_APP_ID` | client-safe | same | n/a |
| 1.9 | `EXPO_PUBLIC_FIREBASE_DATABASE_URL` | client-safe | same; RTDB only — `https://<project>-default-rtdb.firebaseio.com` | RTDB security rules (Phase 0 step 1) |
| 1.10 | `VITE_FIREBASE_*` (admin console) | client-safe | Same web config, but for a separate web app in the same Firebase project. Register a **web** app under the same project. | HTTP referer restriction → your admin domain. |

> ⚠️ The v1 `.env` shipped these `EXPO_PUBLIC_FIREBASE_*` keys directly in the JS bundle. That is **acceptable** for Firebase web keys *only if* they are restricted by bundle/SHA-1/referer in Google Cloud console. An unrestricted key is a quota-drain incident waiting to happen. **Restrict every key before launch.**

### 2. Gemini (AI hot path — alert clarification, briefs, broadcasts)

| # | Var | Side | Where to get it | Restrict by |
|---|---|---|---|---|
| 2.1 | `GEMINI_API_KEY` | **server only** | https://aistudio.google.com/app/apikey → "Create API key" → pick a Google Cloud project | Google Cloud console → APIs & Services → Credentials → click the key → API restrictions → "Restrict key" → allow only **Generative Language API**. Add server IP allowlist in prod. |
| 2.2 | `GEMINI_MODEL` | server | Pick `gemini-2.5-flash` (current v1 model). Document the version in code; never hardcode in client. | n/a |

> The v1 `EXPO_PUBLIC_GEMINI_API_KEY` is the single biggest security gap in v1 — that key is in the JS bundle and in commit `af2996f` on GitHub. **Rotate the v1 Gemini key at https://aistudio.google.com/app/apikey and do not reuse the old value.** The new key goes only into `server/.env`.

### 3. Google Geocoding (server-side reverse geocoding for area descriptions)

PRD §9.2 + open question 6 — use a real geocoder instead of asking the LLM to invent a location name.

| # | Var | Side | Where to get it | Restrict by |
|---|---|---|---|---|
| 3.1 | `GOOGLE_GEOCODING_API_KEY` | **server only** | Google Cloud console → APIs & Services → Library → enable **Geocoding API** → Credentials → "Create credentials" → API key | Restrict to **Geocoding API only** + server IP allowlist in prod. |

### 4. Sign in with Apple (server verification of Apple identity tokens)

| # | Var | Side | Where to get it | Restrict by |
|---|---|---|---|---|
| 4.1 | `APPLE_TEAM_ID` | server | https://developer.apple.com → Account → Membership → Team ID (10 chars) | n/a |
| 4.2 | `APPLE_SERVICES_ID` | server | Apple Developer → Certificates, IDs & Profiles → Identifiers → "+" → **Services IDs** → create one (e.g. `com.beacon5.signin`) | Configure return URLs there. |
| 4.3 | `APPLE_KEY_ID` | server | Apple Developer → Keys → "+" → enable **Sign in with Apple** → register → note the Key ID | n/a |
| 4.4 | `APPLE_PRIVATE_KEY_PATH` *(.p8 file)* | **server only** | Same key creation page — download the `.p8` once (Apple won't let you re-download). Save to `server/secrets/AuthKey_<KEY_ID>.p8` (gitignored). | File perms 600; rotate annually. |

### 5. Google OAuth (Google Sign-In)

You need separate client IDs for each platform.

| # | Var | Side | Where to get it | Restrict by |
|---|---|---|---|---|
| 5.1 | `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | client-safe | Google Cloud console → APIs & Services → Credentials → "Create credentials" → **OAuth client ID** → iOS → enter your iOS bundle ID | Bundle ID restriction is built into the iOS client type. |
| 5.2 | `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` | client-safe | Same flow but **Android** → enter package name + SHA-1 of your signing cert | Package + SHA-1 restriction built in. |
| 5.3 | `GOOGLE_OAUTH_WEB_CLIENT_ID` | server | Same flow but **Web application** → required for server-side ID token verification | Authorized domains. |
| 5.4 | `VITE_GOOGLE_OAUTH_WEB_CLIENT_ID` | client-safe (admin) | Same value as 5.3 (web client ID is shared between server verification and admin browser sign-in). | HTTP referer + authorized JS origins. |

### 6. APNs (Apple Push, mobile app)

| # | Var | Side | Where to get it | Restrict by |
|---|---|---|---|---|
| 6.1 | `APNS_KEY_ID` | server | Apple Developer → Keys → "+" → enable **Apple Push Notifications service (APNs)** → register → note Key ID | n/a |
| 6.2 | `APNS_TEAM_ID` | server | Same as `APPLE_TEAM_ID` (4.1) | n/a |
| 6.3 | `APNS_PRIVATE_KEY_PATH` *(.p8 file)* | **server only** | Download the `.p8` from key creation (once only). Save to `server/secrets/AuthKey_APNS_<KEY_ID>.p8`. | File perms 600. |
| 6.4 | `APNS_BUNDLE_ID` | server | Your iOS app bundle ID (e.g. `com.beacon5.app`). Must match the App ID you registered. | n/a |
| 6.5 | `APNS_ENV` | server | `sandbox` for dev/TestFlight builds, `production` for App Store builds | n/a |

> Critical Alerts entitlement is requested separately from Apple after you have an app in TestFlight — see DECISIONS.md.

### 7. FCM (Firebase Cloud Messaging — Android push)

| # | Var | Side | Where to get it | Restrict by |
|---|---|---|---|---|
| 7.1 | (none — reuses 1.2) | **server only** | The Firebase Admin SDK service account JSON from 1.2 already handles FCM. No separate key needed. | IAM role on the service account. |

The Android app itself needs a `google-services.json` from the Firebase console → register Android app → download. Place at `app/google-services.json` (gitignored). Not strictly an env var; it's a build-time config file.

### 8. Expo Push (optional alternative to direct APNs/FCM)

Recommendation: use Expo Push for now (simpler), migrate to direct APNs/FCM if/when we need Critical Alerts or per-platform tuning.

| # | Var | Side | Where to get it | Restrict by |
|---|---|---|---|---|
| 8.1 | `EXPO_ACCESS_TOKEN` | **server only** | https://expo.dev → click your avatar → Access tokens → "Create" | Token-scoped; rotate quarterly. |
| 8.2 | `EAS_PROJECT_ID` | server (also written into `app/app.json` as `expo.extra.eas.projectId` at `eas build:configure` time) | After `eas init` in `app/`, project ID appears at https://expo.dev/accounts/<you>/projects/<name>/settings | n/a (identifier) |

### 9. Google Maps (Android only — iOS uses Apple Maps via react-native-maps)

| # | Var | Side | Where to get it | Restrict by |
|---|---|---|---|---|
| 9.1 | `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY` | client-safe | Google Cloud console → APIs & Services → Library → enable **Maps SDK for Android** → Credentials → create API key | **Restrict by Android package name + SHA-1** + API restriction to Maps SDK for Android only. Unrestricted = open billing tap. |
| 9.2 | (iOS) | n/a | Apple Maps via react-native-maps `PROVIDER_DEFAULT` — no key. | n/a |

### 10. Sentry (crash reporting)

| # | Var | Side | Where to get it | Restrict by |
|---|---|---|---|---|
| 10.1 | `EXPO_PUBLIC_SENTRY_DSN` | client-safe (DSN is public-by-design) | https://sentry.io → create project → Settings → Client Keys (DSN) | Sentry's per-project rate limits. |
| 10.2 | `VITE_SENTRY_DSN` | client-safe (admin) | Same — create a separate Sentry project for the admin console | Per-project rate limits. |
| 10.3 | `SENTRY_DSN` | server | Same — create a separate Sentry project for the backend | Per-project rate limits. |

### 11. KMS / secrets manager (production only — not needed for dev)

When you move to production, secrets stop living in `server/.env` and start living in a KMS. Pick one provider and stick to it.

| # | Var | Side | Where to get it | Restrict by |
|---|---|---|---|---|
| 11.1 | `KMS_PROVIDER` | server | One of: `gcp` (Cloud KMS), `aws` (KMS), or `azure` (Key Vault). Recommended for this stack: **gcp** since we're already in Google Cloud. | n/a |
| 11.2 | `KMS_KEY_RESOURCE` | server | After enabling Cloud KMS API, create a keyring + key → copy the resource path `projects/X/locations/Y/keyRings/Z/cryptoKeys/W` | IAM: grant the backend service account `Cloud KMS CryptoKey Encrypter/Decrypter`. |

For dev, leave both blank. The env validator only requires them when `NODE_ENV=production`.

---

## Setup order (recommended)

Do this once, before anyone codes:

1. **Apple Developer Program** ($99/yr). Without this, no iOS App Store, no APNs, no Sign in with Apple. Do this first because Apple's review takes 24–48h.
2. **Google Cloud + Firebase dev project.** Create `beacon5-dev` in Firebase console (which auto-creates the GCP project). Enable billing on the GCP project (free tier covers dev).
3. **Provision Firebase web config + service account** (rows 1.1–1.9 + 1.10 for admin).
4. **Rotate the v1 Gemini key**, create a new one for `server/.env`, restrict it to Generative Language API.
5. **Google OAuth + Sign in with Apple** identifiers (you'll need them before you can register users).
6. **APNs key + FCM service account** (push setup).
7. **Sentry** (3 projects — server, app, admin).
8. **Google Maps Android key** (only when you're ready to build the Android map view).

Staging + prod projects can wait until the first pilot deployment.

---

## What to do when you find a leaked key

1. Don't push anything.
2. Rotate the key at its origin (revoke + reissue).
3. Update `server/.env` (and your KMS in prod).
4. If the leak hit git history: assume it's compromised forever and rotate. `git filter-repo` cannot un-leak something that's already been cloned.
5. Add it to this file with the five details if it wasn't already documented.

---

## Anchors used by the env validator

The boot-time validator throws errors that reference these section anchors. When you see an error like `Missing GEMINI_API_KEY — see KEYS.md §2`, jump to section 2 above.

- §1 — Firebase
- §2 — Gemini
- §3 — Geocoding
- §4 — Sign in with Apple
- §5 — Google OAuth
- §6 — APNs
- §7 — FCM
- §8 — Expo Push
- §9 — Google Maps
- §10 — Sentry
- §11 — KMS
