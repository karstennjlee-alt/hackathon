# supabase/

All Supabase config lives here: SQL migrations, RLS policies, seed scripts.

## Apply the schema

Two ways:

### A. Dashboard (easiest)

1. Supabase dashboard → SQL editor → New query
2. Paste the contents of [`migrations/001_init.sql`](migrations/001_init.sql)
3. Run

The file is idempotent — re-running is safe (every `CREATE` uses `IF NOT EXISTS`).

### B. CLI (recommended once you have one)

```bash
brew install supabase/tap/supabase
supabase link --project-ref iyjoqlixbatyfguxizko
supabase db push                       # pushes migrations/ to the linked project
```

## Auth provider setup (do this in the dashboard)

Authentication → Providers:

- **Email** — toggle on. Choose Magic Link (passwordless) or password. Magic Link is the lowest-friction default for v2.
- **Google** — toggle on, paste in your Google OAuth Web Client ID + Secret ([KEYS.md §5.3](../KEYS.md)). Add `https://iyjoqlixbatyfguxizko.supabase.co/auth/v1/callback` to authorized redirect URIs in Google Cloud → Credentials.
- **Apple** — toggle on, paste in Services ID, Team ID, Key ID, `.p8` contents ([KEYS.md §4](../KEYS.md)). Supabase becomes the relying party — Apple sends the user back to `https://iyjoqlixbatyfguxizko.supabase.co/auth/v1/callback`.

The app's `signInWithOAuth({ provider })` call works once each provider is toggled on with valid credentials.

## Custom claims contract

All RLS policies in `001_init.sql` read from `auth.jwt()`:

```ts
auth.users.raw_app_meta_data = {
  campus_id: "<uuid>",
  role: "student" | "parent" | "staff" | "admin"
}
```

The server (POST /v1/auth/session) sets these via the Admin SDK after a User row exists in `public.users`. On the client, after `signInWithOAuth` or `signInWithOtp` succeeds, call:

```ts
await supabase.auth.refreshSession();
```

…to pick up the new claims. Without that, the previously-issued JWT still has empty claims and RLS will reject reads.

## What's not yet in the schema

- **Write policies** for most tables — left blank intentionally. All writes for incidents/threats/messages/audit go through the server (`service_role` key bypasses RLS). Per PRD §11 + §10.3 — authoritative backend mediates every state change.
- **Retention purge function** (R8.6 + §11). Will land in a later migration as a scheduled `pg_cron` job that deletes `location_points` older than `campuses.policy->>'retentionDays'`.
- **Triggers** for `updated_at` columns. Add when we hit our first mutable field; nothing mutable today (messages + audit are immutable; everything else is server-write).
