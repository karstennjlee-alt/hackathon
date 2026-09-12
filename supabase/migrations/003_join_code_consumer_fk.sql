-- ════════════════════════════════════════════════════════════════════
--  003 — join_codes.consumed_by must reference auth.users, not public.users
--
--  /v1/auth/join claims the code (sets consumed_by = auth uid) BEFORE it
--  inserts the public.users row, so the original FK to public.users(id)
--  fired on every redemption and join never succeeded. The auth user
--  always exists at claim time; that's the right parent.
-- ════════════════════════════════════════════════════════════════════

alter table public.join_codes
  drop constraint if exists join_codes_consumed_by_fkey;

alter table public.join_codes
  add constraint join_codes_consumed_by_fkey
  foreign key (consumed_by) references auth.users(id) on delete set null;
