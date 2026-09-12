# Beacon5 — standing up a campus

What a school needs to go from nothing to every student, teacher and parent signed in.
Everything below is in the app; the office never touches a terminal.

> Beacon5 is a coordination tool. It is **not** a replacement for 911 or the school's crisis plan.

## 0. One-time, by whoever operates the service

| Piece | What | Where |
|---|---|---|
| Supabase | Project + migrations `001`–`006` applied (`supabase db query --linked -f …`) | [supabase/README.md](supabase/README.md) |
| Email template | Auth → Email Templates → Magic Link body: `{{ .SiteURL }}/auth-callback?token_hash={{ .TokenHash }}&type=magiclink`, Site URL = `beacon5://` | Supabase dashboard |
| Server | `server/.env` per [KEYS.md](KEYS.md); `npm run dev:server`; reachable at `EXPO_PUBLIC_API_BASE_URL` | [server/README.md](server/README.md) |
| App build | A **development or store build** (`eas build`) with `extra.eas.projectId` set. Expo Go works for everything except push notifications. | `app/app.json` |
| Optional | Apple / Google providers in Supabase Auth → Providers. Email works with nothing configured. | [KEYS.md §4–5](KEYS.md) |

## 1. First admin creates the campus (2 minutes)

1. Open the app → **Staff & family** → sign in with email (magic link) or password.
2. "Join your campus" → **Create a new campus** → org name, campus name, your name.
3. You are the campus admin. Settings (gear) → **Manage campus**.
4. **Campus** tab shows the **campus code** (6 characters). Students will type this.

## 2. Add staff

Manage campus → **Staff** → *New staff code*. Hand the code to a teacher; they sign in with
email (Staff & family), then enter the code. One use, 3 days. *New admin code* for other admins.

Staff can: activate a beacon, see the fleet map, verify incidents, message families,
declare and clear a campus threat, reset PINs, issue parent codes.
Only admins add students and other admins.

## 3. Add students

Manage campus → **Students** → name + the school's student ID → **Add & get PIN**.
A 6-digit PIN appears once. Write it on the student's card / hand it out with the campus code.

Student sign-in = **Student** tab → campus code + student ID + PIN. No email needed.
Wrong PIN 5× locks the student for 15 minutes; **Reset PIN** on their row issues a new one.

Bulk import: `POST /v1/roster/students` accepts up to 200 students per call
(`[{studentId, displayName, pin?}]`) — a CSV importer in the app is on the roadmap.

## 4. Link parents

Manage campus → **Students** → *Parent code* on the student's row → give the code to the
parent. They sign in with email (Staff & family) and enter it; that creates their account
**and** the verified link to that one student. One code per guardian, 7 days, one use.

Parents see official updates and staff broadcasts about their child, and can message staff.
They never see other students or live location.

## 5. What happens in an incident

- Student holds the beacon → staff phones alert (push + in-app), guardians get a calm
  "staff are responding" note. Location streams only while the beacon is active.
- Staff declare a campus threat (confirm dialog, logged with their name) → every device
  on campus is armed; parents get an official "do not travel to the school" update.
- All clear → everything disarms, tracking stops, all-clear goes out.
- Location traces are purged nightly after the campus retention window (default 90 days).

## Known limits (honest list)

- **Push needs a real build.** In Expo Go the app still raises local notifications while
  open, but nothing arrives when it's closed.
- **No MFA yet.** Threat declare/clear is gated by role + campus policy + confirm + audit,
  not a second factor. Supabase MFA (`aal2`) is the planned step-up.
- **Zones are still the built-in four** (West Wing, Cafeteria, Gym, Main Office). A zone
  editor is next on the admin screen.
- **No CSV import UI** yet (API supports batches).
- Web admin console doesn't exist; everything is in the mobile app on purpose for now.
