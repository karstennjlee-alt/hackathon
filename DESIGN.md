# Beacon5 v2 — Design language

A short note so every screen we build feels like the same product. This is the design system; we ship it before screens.

> **The rule:** if a scared 12-year-old can't use it instantly, it's wrong. ([PRD §5](PRD.md), Principle 1.)

---

## Principles in interaction terms

| Principle | What it forces on every screen |
|---|---|
| Designed for panic | One obvious next action per screen. Primary target ≥ 64×64pt. Two taps max from any role's home to "I need help" or "I'm declaring a threat." |
| Less confusion = more safety | Fewer elements per screen, not more. If we add a feature, look first for what to remove. |
| Honest states | Verification, location, and connectivity always have an explicit visual + textual state. Never imply certainty we don't have. |
| Silent on student side during threat | Haptic-only confirmation. No conspicuous sound or flash on the student device while a threat is active. |
| Trust is the product | Verification level and message authorship are unmistakable. Parents must be able to tell "official" from "guess" at a glance. |
| Accessible is part of "amazing" | Dynamic type, screen-reader complete, no info by color alone, non-hold trigger as a first-class path. |

---

## Tokens

Tokens live in `shared/src/design/tokens.ts` (added in step 7). Every screen consumes from there; no raw hex values in components.

### Color (functional, not decorative)

| Token | Light | Dark | Use |
|---|---|---|---|
| `surface.bg` | `#FAFAFC` | `#0B0F14` | App background |
| `surface.card` | `#FFFFFF` | `#141A22` | Card / sheet |
| `surface.muted` | `#F2F3F7` | `#1A2230` | Subdued surfaces |
| `border.subtle` | `rgba(0,0,0,0.06)` | `rgba(255,255,255,0.06)` | Hairlines |
| `text.primary` | `#0B0F14` | `#F5F7FA` | Body |
| `text.secondary` | `#3D4654` | `#A6B0BD` | Captions, meta |
| `text.muted` | `#6B7280` | `#7B8794` | Hints |
| `brand.primary` | `#2563EB` | `#3B82F6` | Default brand (orgs override per-campus) |
| `danger.solid` | `#DC2626` | `#DC2626` | THREAT, beacon active, medical critical |
| `danger.soft` | `#FEE2E2` | `#3F1416` | Danger backgrounds |
| `warning.solid` | `#D97706` | `#F59E0B` | Caution, "GPS pending", medical mild |
| `success.solid` | `#059669` | `#10B981` | All-clear, verified, "I'm safe" |
| `info.solid` | `#0891B2` | `#22D3EE` | Informational broadcasts |

**Verification color, never alone:** every state below pairs color + icon + text label.

### Spacing

`4 · 8 · 12 · 16 · 24 · 32 · 48 · 64` (px). Use the closest token; never an arbitrary value.

### Radii

| Token | Value | Use |
|---|---|---|
| `radius.sm` | 8 | Pills, chips |
| `radius.md` | 14 | Inputs, small cards |
| `radius.lg` | 20 | Cards, sheets |
| `radius.xl` | 28 | Hero (beacon ring, big buttons) |

### Type scale

Defined as `style + dynamic-type-aware`. Pin to system font for native feel.

| Token | Size / weight | Use |
|---|---|---|
| `type.display` | 34 / 700 | Hero numerals, threat banner |
| `type.title` | 22 / 700 | Screen title, sheet title |
| `type.heading` | 17 / 600 | Card title |
| `type.body` | 17 / 400 | Body text |
| `type.label` | 13 / 600 | Pill, chip, label |
| `type.caption` | 12 / 500 | Meta |
| `type.mono` | 14 / 500 mono | Timestamps |

Every token honors iOS Dynamic Type and Android font scaling.

### Motion

| Token | Duration | Curve | Use |
|---|---|---|---|
| `motion.calm` | 220ms | ease-out | Default for sheets, fades |
| `motion.fast` | 120ms | ease-out | Taps, hovers |
| `motion.hold` | 1000ms linear | linear | Beacon hold-to-activate ring |

**No bouncy springs.** This is a safety product, not a game. Motion is calm and predictable.

### Haptic vocabulary

| Token | Native call | Use |
|---|---|---|
| `haptic.tick` | `selectionAsync` | Hold progress every 250ms |
| `haptic.confirm` | `notificationAsync(Success)` | Beacon armed; broadcast sent; all-clear |
| `haptic.warn` | `notificationAsync(Warning)` | Step-up auth required; misfire confirm |
| `haptic.alert` | `notificationAsync(Error)` | Threat declared (staff side); medical critical |

---

## State vocabulary (the part that defeats rumor)

Beacon5 is fundamentally a trust signal carrier. The visual treatment of state matters more than any other UI choice. Every state has **color + icon + text** — never color alone.

### Verification (incident clusters, R8.2 + R8.5 + R8.11.2)

| State | Color | Icon (lucide) | Label |
|---|---|---|---|
| `pending` | `text.muted` | `circle-dashed` | "Pending" |
| `forming` | `warning.solid` | `circle-dot` | "Forming" |
| `verified` | `info.solid` | `circle-check` | "Verified" |
| `staff-confirmed` | `success.solid` | `shield-check` | "Staff confirmed" |

### Location (R8.6.3 + R8.6.4)

| State | Color | Icon | Label |
|---|---|---|---|
| `off` | `text.muted` | `map-pin-off` | "Location off" |
| `pending` | `warning.solid` | `loader-2` (rotating) | "GPS pending" |
| `approximate` | `warning.solid` | `circle-dot` | "Approximate · ±{n}m" |
| `live` | `success.solid` | `map-pin` | "Tracking active · ±{n}m" |
| `stale` | `text.muted` | `map-pin` | "Last seen {time}" |

The accuracy radius is always rendered on maps when location is shown. Never imply precision we don't have.

### Connectivity (R8.6 fail-loud)

| State | Color | Icon | Label |
|---|---|---|---|
| `online` | (no chip, default) | — | — |
| `queued` | `warning.solid` | `cloud-off` | "Queued · {n} updates" |
| `offline` | `danger.solid` | `wifi-off` | "Offline · alerts will send when reconnected" |

### Authorship (R8.8.1 + trust)

Every message renders the sender's role badge next to the body:

| Role | Badge color | Badge text |
|---|---|---|
| Admin | `brand.primary` | "PRINCIPAL" / "ADMIN" |
| Staff | `info.solid` | "TEACHER" / "STAFF" |
| Parent | `text.secondary` | "PARENT" |
| Student | `text.muted` | "STUDENT" |
| System | `text.muted` italic | "AUTOMATED" |

This is the single biggest defense against rumor. No anonymous messages.

---

## Core components (the four that matter)

Anything past the first launch flow is built from these primitives.

### 1. `BigButton`

Primary action on every screen — the panic-grade target.

```
┌─────────────────────────────────┐
│                                 │
│   ⬤  THREAT                     │
│                                 │
│   Tap to declare — confirm next │
└─────────────────────────────────┘
```

- Min height 80, full width minus 16pt margin.
- 28pt icon left, 22pt title, 13pt caption.
- States: `default`, `pressed` (scale 0.98), `loading` (replace icon with `loader-2`), `disabled` (50% opacity + textual reason below).
- Variants: `primary` (brand), `danger` (THREAT, beacon, declare), `success` (ALL CLEAR), `secondary` (transparent).
- A11y label = title + caption joined. `accessibilityRole="button"`. Press-and-hold variants expose an alternative tap-confirm via R8.5.2.

### 2. `BeaconRing`

The hold-to-activate primitive. Lives only on the student home screen.

- SVG ring fills clockwise over 1000ms (`motion.hold`).
- Inner pulsing dot when armed.
- Haptic tick every 250ms during hold (`haptic.tick`); confirm on completion (`haptic.confirm`).
- **Accessible alternative:** screen-reader users see a `BigButton` "Activate beacon" with a confirm-step modal. (R8.5.2.)
- Silent on student device during a threat (no sound, no flash) — only haptic.

### 3. `StateChip`

Pill that renders any state from the vocabulary above. Always color + icon + text.

```
┌─ ⌖ Tracking active · ±8m ──┐
```

- Used on every map marker, every message header, every connectivity edge.
- One source of truth — never inline a "Tracking" text without using StateChip.

### 4. `AudienceChip`

Multi-select for mass-broadcast targeting (Students / Parents / Teachers / Everyone). Replaces v1's wrapped text.

- 36pt height, `numberOfLines={1}`, center-aligned, `adjustsFontSizeToFit`.
- Selected state: `brand.primary` fill, white text.
- "Everyone" is a shortcut — selecting it auto-selects all others and shows them as filled-but-locked.

---

## Per-role surfaces

The PRD calls for "distinct surfaces per role." Each role's home screen is one thing.

### Student — *one beacon*

```
╔════════════════════════════════╗
║                                ║
║       Hold to send beacon       ║
║                                ║
║         (BeaconRing 280pt)      ║
║                                ║
║  Or: [ Activate beacon ] (tap)  ║
║                                ║
║   You're not alone. Staff will  ║
║   see you immediately.          ║
║                                ║
╚════════════════════════════════╝
```

Nothing else. No feed, no chat tab, no settings. (Settings opens via a 22pt gear top-right, but it's not the screen.)

### Staff — *Mission Control*

```
╔════════════════════════════════════╗
║  San Jose High  · Wed 10:14am     ║
║  [ THREAT — declare ]              ║   ← BigButton danger, top-of-screen
║─────────────────────────────────────║
║  Fleet                              ║
║  [ FleetMap with markers + chips ] ║
║                                     ║
║  Verified · 3   Forming · 1         ║
║  Pending · 0    Off-map · 2         ║
║─────────────────────────────────────║
║  Recent                             ║
║  ⌖ Maya · ±6m · 10:13 · Verified    ║
║  ⌖ Liam · GPS pending · 10:13       ║
║  …                                  ║
╚════════════════════════════════════╝
```

Map + counts + recent list. THREAT button always visible at top, vivid in both states.

### Parent — *one card*

```
╔════════════════════════════════════╗
║  Maya · Grade 9                     ║
║                                     ║
║  ┌───────────────────────────────┐ ║
║  │  ⌖ Tracking active · ±8m       │ ║
║  │  Near cafeteria entrance       │ ║
║  │                                │ ║
║  │  Latest update · 10:14am        │ ║
║  │  PRINCIPAL: "All students are   │ ║
║  │  accounted for. Stay where      │ ║
║  │  you are. Updates every 5 min." │ ║
║  │                                │ ║
║  │  [ Message Maya's teacher ]    │ ║
║  └───────────────────────────────┘ ║
╚════════════════════════════════════╝
```

One child = one card. Multiple children = a stack of cards, one per child. No fleet view, ever.

### Admin (Principal) — *control panel*

Staff Mission Control + a "Broadcast" composer + "Roster, Zones, Policy" tabs that link to the web admin console for heavy editing.

---

## What we don't build (yet)

- No tab bars. Each role has one home and one settings sheet. Tab bars invite feature creep.
- No notifications inbox. Push is the inbox; in-app reads from the same `Message` log scoped by role.
- No avatars. Identity is the role badge + name, not a photo. (FERPA + parents don't recognize other kids' faces.)
- No emoji reactions. Wrong tone for the product.

---

## Open visual questions for next session

- Beacon ring micro-interaction: 1000ms linear (DECISIONS.md hints at this) or a faint ease-out at the end? Test on a phone.
- Staff fleet map default zoom: city, campus, building? Campus-level by default; auto-zoom to fit incidents.
- Branding: how strong should brand color go? Border-only on most surfaces; full-fill only on primary BigButton, message badge, and the campus title chip.
