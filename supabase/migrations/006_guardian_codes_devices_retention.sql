-- ════════════════════════════════════════════════════════════════════
--  006 — guardian codes, device registry constraints, retention purge
-- ════════════════════════════════════════════════════════════════════

-- ── Guardian codes: a join code bound to one student, role 'parent'.
--    Redeeming it creates the parent account AND a verified guardian_link
--    (R8.1.4 — linking is provisioned by the school, never self-asserted).
alter table public.join_codes drop constraint if exists join_codes_role_check;
alter table public.join_codes
  add constraint join_codes_role_check check (role in ('student','staff','admin','parent'));

alter table public.join_codes
  add column if not exists student_user_id uuid references public.users(id) on delete cascade;

alter table public.join_codes drop constraint if exists join_codes_parent_needs_student;
alter table public.join_codes
  add constraint join_codes_parent_needs_student
  check (role <> 'parent' or student_user_id is not null);

-- ── Devices: one row per (user, token); server upserts on registration.
create unique index if not exists devices_user_token_unique on public.devices(user_id, push_token);
create index if not exists devices_user on public.devices(user_id);

-- ── Retention: purge location traces older than each campus's policy
--    window (default 90 days). Runs nightly. PRD §11.2 / R8.6.
create extension if not exists pg_cron;

create or replace function public.purge_location_points() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with gone as (
    delete from public.location_points lp
    using public.campuses c
    where c.id = lp.campus_id
      and lp.at < now() - make_interval(days => coalesce((c.policy->>'retentionDays')::int, 90))
    returning 1
  )
  select count(*) into n from gone;
  return n;
end $$;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'beacon5-purge-location-points') then
    perform cron.schedule('beacon5-purge-location-points', '17 3 * * *', 'select public.purge_location_points()');
  end if;
end $$;
