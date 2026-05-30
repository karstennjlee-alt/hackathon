# @beacon5/admin

Web admin console for Beacon5 v2. This is the heart of "anybody can use & customize" (PRD §16).

**Status:** Not yet implemented. Phase 0 step 11.

## What goes here

- Org / campus creation + settings (R8.10.1)
- Roster management — add/import/verify, role assignment, join codes, guardian-link approval (R8.10.2)
- Zone editor — define zones/buildings/rooms, optional geofences (R8.10.3) → **replaces v1's 4 hardcoded zones**
- Branding — display name, logo, colors (R8.10.4) → **replaces v1's hardcoded "San Jose High"**
- Policy config — who can declare threats, default audiences, retention, location policy, language, 911-mention toggle (default OFF) (R8.10.5)
- Read-only exportable audit log viewer (R8.10.6)

## Stack (planned)

Vite + React + TypeScript + Tailwind + `@beacon5/shared` types.

Talks to the same backend at `VITE_API_BASE_URL` as the mobile app. No direct Firebase writes; every admin action goes through the server for audit + step-up auth.
