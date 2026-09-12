-- ════════════════════════════════════════════════════════════════════
--  005 — every campus member can read staff/admin display names
--
--  Students and parents see broadcasts and chat from staff; the app
--  resolves sender_user_id → display_name through public.users. With
--  only "own row" readable, every teacher rendered as "Campus member".
--  Staff/admin identities are not sensitive within their own campus;
--  student rows stay restricted (staff-only, per 001).
-- ════════════════════════════════════════════════════════════════════

drop policy if exists "members read staff names" on public.users;
create policy "members read staff names"
  on public.users for select to authenticated
  using (campus_id = public.jwt_campus_id() and role in ('staff', 'admin'));
