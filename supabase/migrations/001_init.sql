-- ════════════════════════════════════════════════════════════════════
--  Beacon5 v2 — initial schema + Row Level Security
--  Source: PRD §10–12. Closes gap G4 (tenant isolation).
--
--  Run this once in Supabase dashboard → SQL editor → New query → Run.
--  Re-runnable: every CREATE uses IF NOT EXISTS where possible.
--
--  Custom claims contract — set by /v1/auth/session via the Admin SDK:
--    auth.users.raw_app_meta_data jsonb shape =
--      { campus_id: uuid, role: 'student'|'parent'|'staff'|'admin' }
--    Linked students for parents come from the guardian_links table
--    (not from claims) so they always reflect current roster state.
-- ════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────
-- Extensions
-- ──────────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- ──────────────────────────────────────────────────────────────────
-- Helpers: read custom claims off the JWT.
-- These are SECURITY DEFINER stable functions used in every RLS policy.
-- ──────────────────────────────────────────────────────────────────
create or replace function public.jwt_campus_id() returns uuid
language sql stable as $$
  select nullif(coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'campus_id'),
    ''
  ), '')::uuid;
$$;

create or replace function public.jwt_role() returns text
language sql stable as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '');
$$;

create or replace function public.is_staff() returns boolean
language sql stable as $$
  select public.jwt_role() in ('staff', 'admin');
$$;

create or replace function public.is_admin() returns boolean
language sql stable as $$
  select public.jwt_role() = 'admin';
$$;

create or replace function public.is_student() returns boolean
language sql stable as $$
  select public.jwt_role() = 'student';
$$;

create or replace function public.is_parent() returns boolean
language sql stable as $$
  select public.jwt_role() = 'parent';
$$;

-- is_linked_guardian() is defined LATER, after guardian_links table exists,
-- because SQL function bodies are parsed eagerly at CREATE FUNCTION time.

-- ──────────────────────────────────────────────────────────────────
-- organizations
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.organizations (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  type         text not null check (type in ('school','workplace','hospital','other')),
  created_at   timestamptz not null default now()
);

alter table public.organizations enable row level security;

create policy "orgs readable by any authed user"
  on public.organizations for select to authenticated using (true);
-- writes via service_role only — no insert/update/delete policies.

-- ──────────────────────────────────────────────────────────────────
-- campuses (tenant root)
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.campuses (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  name         text not null,
  branding     jsonb not null default '{}'::jsonb,
  policy       jsonb not null default jsonb_build_object(
    'whoCanDeclareThreat','any-staff',
    'locationPolicy','on-activation',
    'defaultAudiences', jsonb_build_array('students','parents','teachers'),
    'retentionDays', 90,
    'languages', jsonb_build_array('en'),
    'allow911Mention', false,
    'studentProvisioning','school'
  ),
  created_at   timestamptz not null default now()
);

alter table public.campuses enable row level security;

create policy "campus readable by its members"
  on public.campuses for select to authenticated
  using (id = public.jwt_campus_id());

-- ──────────────────────────────────────────────────────────────────
-- users (one record per auth.users entry; bound to one campus per R8.1.2)
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.users (
  id              uuid primary key references auth.users(id) on delete cascade,
  campus_id       uuid not null references public.campuses(id) on delete cascade,
  role            text not null check (role in ('student','parent','staff','admin')),
  display_name    text not null,
  is_minor        boolean not null default false,
  auth_provider   text,
  created_at      timestamptz not null default now()
);

create unique index if not exists users_one_campus_per_uid on public.users(id);

alter table public.users enable row level security;

create policy "user reads own row"
  on public.users for select to authenticated
  using (id = auth.uid() and campus_id = public.jwt_campus_id());

create policy "staff reads campus roster"
  on public.users for select to authenticated
  using (campus_id = public.jwt_campus_id() and public.is_staff());

-- ──────────────────────────────────────────────────────────────────
-- guardian_links
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.guardian_links (
  id                 uuid primary key default gen_random_uuid(),
  campus_id          uuid not null references public.campuses(id) on delete cascade,
  guardian_user_id   uuid not null references public.users(id) on delete cascade,
  student_user_id    uuid not null references public.users(id) on delete cascade,
  verified           boolean not null default false,
  created_at         timestamptz not null default now(),
  unique (guardian_user_id, student_user_id)
);

alter table public.guardian_links enable row level security;

create policy "guardian reads own links"
  on public.guardian_links for select to authenticated
  using (
    campus_id = public.jwt_campus_id()
    and (guardian_user_id = auth.uid() or public.is_staff())
  );

-- Now that guardian_links exists, define the helper that depends on it.
create or replace function public.is_linked_guardian(student_uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.guardian_links gl
    where gl.guardian_user_id = auth.uid()
      and gl.student_user_id = student_uid
      and gl.verified = true
  );
$$;

-- ──────────────────────────────────────────────────────────────────
-- zones
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.zones (
  id         uuid primary key default gen_random_uuid(),
  campus_id  uuid not null references public.campuses(id) on delete cascade,
  title      text not null,
  building   text,
  room       text,
  geo        jsonb
);

alter table public.zones enable row level security;

create policy "zones readable by campus members"
  on public.zones for select to authenticated
  using (campus_id = public.jwt_campus_id());

-- ──────────────────────────────────────────────────────────────────
-- campus_threats — declared/cleared via server step-up auth only
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.campus_threats (
  id              uuid primary key default gen_random_uuid(),
  campus_id       uuid not null references public.campuses(id) on delete cascade,
  status          text not null check (status in ('active','cleared')),
  actor_user_id   uuid not null references public.users(id),
  at              timestamptz not null default now()
);

create index if not exists campus_threats_campus_at on public.campus_threats(campus_id, at desc);

alter table public.campus_threats enable row level security;

create policy "campus threats readable by members"
  on public.campus_threats for select to authenticated
  using (campus_id = public.jwt_campus_id());

-- ──────────────────────────────────────────────────────────────────
-- incidents
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.incidents (
  id                  uuid primary key default gen_random_uuid(),
  campus_id           uuid not null references public.campuses(id) on delete cascade,
  student_user_id     uuid not null references public.users(id) on delete cascade,
  status              text not null check (status in ('active','cleared','reset')),
  activated_at        timestamptz not null default now(),
  cleared_at          timestamptz,
  escalation          jsonb not null default '{}'::jsonb,
  last_known_coords   jsonb,
  zone_hint           text
);

create index if not exists incidents_campus_status on public.incidents(campus_id, status, activated_at desc);

alter table public.incidents enable row level security;

create policy "students see own incidents"
  on public.incidents for select to authenticated
  using (campus_id = public.jwt_campus_id() and student_user_id = auth.uid());

create policy "staff see all campus incidents"
  on public.incidents for select to authenticated
  using (campus_id = public.jwt_campus_id() and public.is_staff());

create policy "parents see linked child incidents"
  on public.incidents for select to authenticated
  using (campus_id = public.jwt_campus_id() and public.is_parent()
         and public.is_linked_guardian(student_user_id));

-- ──────────────────────────────────────────────────────────────────
-- location_points
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.location_points (
  id              uuid primary key default gen_random_uuid(),
  campus_id       uuid not null references public.campuses(id) on delete cascade,
  incident_id     uuid not null references public.incidents(id) on delete cascade,
  student_user_id uuid not null references public.users(id) on delete cascade,
  coords          jsonb not null,
  at              timestamptz not null default now()
);

create index if not exists location_points_incident_at on public.location_points(incident_id, at);

alter table public.location_points enable row level security;

create policy "students see own location points"
  on public.location_points for select to authenticated
  using (campus_id = public.jwt_campus_id() and student_user_id = auth.uid());

create policy "staff see all campus location points"
  on public.location_points for select to authenticated
  using (campus_id = public.jwt_campus_id() and public.is_staff());

create policy "parents see linked child location points"
  on public.location_points for select to authenticated
  using (campus_id = public.jwt_campus_id() and public.is_parent()
         and public.is_linked_guardian(student_user_id));

-- ──────────────────────────────────────────────────────────────────
-- messages (chat + broadcast + mass) — IMMUTABLE per R8.8.3
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.messages (
  id                uuid primary key default gen_random_uuid(),
  campus_id         uuid not null references public.campuses(id) on delete cascade,
  kind              text not null check (kind in ('chat','broadcast','mass')),
  sender_user_id    uuid not null references public.users(id),
  sender_role       text not null,
  audience          text[] default null,
  student_user_id   uuid references public.users(id),
  body              text not null,
  clarified_body    text,
  at                timestamptz not null default now()
);

create index if not exists messages_campus_kind_at on public.messages(campus_id, kind, at desc);
create index if not exists messages_campus_student_at on public.messages(campus_id, student_user_id, at desc);

alter table public.messages enable row level security;

-- No update/delete policies — messages are immutable. Server retracts by inserting a superseded record.

create policy "staff see all campus messages"
  on public.messages for select to authenticated
  using (campus_id = public.jwt_campus_id() and public.is_staff());

create policy "sender sees own messages"
  on public.messages for select to authenticated
  using (campus_id = public.jwt_campus_id() and sender_user_id = auth.uid());

create policy "students see mass to students or everyone"
  on public.messages for select to authenticated
  using (
    campus_id = public.jwt_campus_id() and public.is_student()
    and kind = 'mass'
    and (audience @> array['students'] or audience @> array['everyone'])
  );

create policy "parents see mass to parents or everyone, plus linked-child chat"
  on public.messages for select to authenticated
  using (
    campus_id = public.jwt_campus_id() and public.is_parent()
    and (
      (kind = 'mass' and (audience @> array['parents'] or audience @> array['everyone']))
      or (kind = 'chat' and public.is_linked_guardian(student_user_id))
    )
  );

-- ──────────────────────────────────────────────────────────────────
-- audit_events — admin read-only, server-only writes, IMMUTABLE
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.audit_events (
  id              uuid primary key default gen_random_uuid(),
  campus_id       uuid not null references public.campuses(id) on delete cascade,
  actor_user_id   uuid references public.users(id),
  action          text not null,
  target          text,
  metadata        jsonb,
  at              timestamptz not null default now()
);

create index if not exists audit_events_campus_action_at on public.audit_events(campus_id, action, at desc);

alter table public.audit_events enable row level security;

create policy "admin reads campus audit"
  on public.audit_events for select to authenticated
  using (campus_id = public.jwt_campus_id() and public.is_admin());

-- ──────────────────────────────────────────────────────────────────
-- consent_records
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.consent_records (
  id          uuid primary key default gen_random_uuid(),
  campus_id   uuid not null references public.campuses(id) on delete cascade,
  user_id     uuid not null references public.users(id) on delete cascade,
  type        text not null check (type in ('parental','school-official','self')),
  scope       text not null,
  granted_by  uuid references public.users(id),
  at          timestamptz not null default now()
);

alter table public.consent_records enable row level security;

create policy "own consent or admin"
  on public.consent_records for select to authenticated
  using (campus_id = public.jwt_campus_id() and (user_id = auth.uid() or public.is_admin()));

-- ──────────────────────────────────────────────────────────────────
-- devices — push tokens; own row only
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.devices (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  push_token   text not null,
  platform     text not null check (platform in ('ios','android')),
  last_seen_at timestamptz not null default now()
);

alter table public.devices enable row level security;

create policy "own device rows"
  on public.devices for select to authenticated
  using (user_id = auth.uid());

create policy "own device upsert"
  on public.devices for insert to authenticated
  with check (user_id = auth.uid());

create policy "own device update"
  on public.devices for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ──────────────────────────────────────────────────────────────────
-- join_codes — staff-readable, server-only writes; redemption is server-side
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.join_codes (
  code           text primary key,
  campus_id      uuid not null references public.campuses(id) on delete cascade,
  role           text not null check (role in ('student','staff','admin')),
  created_by     uuid references public.users(id),
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  consumed_by    uuid references public.users(id),
  consumed_at    timestamptz
);

create index if not exists join_codes_campus_created on public.join_codes(campus_id, created_at desc);

alter table public.join_codes enable row level security;

create policy "staff lists campus join codes"
  on public.join_codes for select to authenticated
  using (campus_id = public.jwt_campus_id() and public.is_staff());

-- ──────────────────────────────────────────────────────────────────
-- realtime — enable replication on the live-update tables
-- ──────────────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.campus_threats;
alter publication supabase_realtime add table public.incidents;
alter publication supabase_realtime add table public.location_points;
alter publication supabase_realtime add table public.messages;
