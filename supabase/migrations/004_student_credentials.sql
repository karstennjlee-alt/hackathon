-- ════════════════════════════════════════════════════════════════════
--  004 — student ID sign-in
--
--  Students (minors, mostly no email) sign in with
--    campus code + student ID + PIN
--  instead of an identity provider. The school provisions the account;
--  the server owns the auth.users row (synthetic email, never mailed)
--  and mints a one-shot magic-link token hash after a PIN check.
-- ════════════════════════════════════════════════════════════════════

-- Short, human-typeable campus code. Not a secret (like the school name);
-- the PIN is the secret. Backfilled for existing campuses.
alter table public.campuses add column if not exists code text;

update public.campuses
   set code = upper(substr(replace(encode(gen_random_bytes(6), 'base64'), '/', 'X'), 1, 6))
 where code is null;

alter table public.campuses alter column code set not null;
create unique index if not exists campuses_code_unique on public.campuses(code);

create table if not exists public.student_credentials (
  campus_id        uuid not null references public.campuses(id) on delete cascade,
  student_id       text not null,                       -- the school's own ID, as typed
  auth_user_id     uuid not null unique references auth.users(id) on delete cascade,
  pin_hash         text not null,                       -- scrypt, server-side only
  failed_attempts  int  not null default 0,
  locked_until     timestamptz,
  created_by       uuid references public.users(id),
  created_at       timestamptz not null default now(),
  pin_rotated_at   timestamptz,
  primary key (campus_id, student_id)
);

alter table public.student_credentials enable row level security;

-- Staff may see who is provisioned (never the hash — select the columns
-- you need; the app only reads student_id + created_at). Writes are
-- server-only via service_role.
drop policy if exists "staff lists campus student credentials" on public.student_credentials;
create policy "staff lists campus student credentials"
  on public.student_credentials for select to authenticated
  using (campus_id = public.jwt_campus_id() and public.is_staff());

-- Defense in depth: even staff can't read pin_hash through PostgREST.
revoke select (pin_hash) on public.student_credentials from authenticated;
