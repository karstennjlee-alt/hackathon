-- ════════════════════════════════════════════════════════════════════
--  002 — students can read staff broadcasts addressed to them
--
--  001 gave students only `mass` messages. A staff all-clear / update is
--  kind='broadcast' with student_user_id = the student, and the student
--  device relies on it to end its own incident (v1 STAFF_BROADCAST path).
--  Without this policy Realtime never delivers it to the student.
-- ════════════════════════════════════════════════════════════════════

drop policy if exists "students see broadcasts about themselves" on public.messages;
create policy "students see broadcasts about themselves"
  on public.messages for select to authenticated
  using (
    campus_id = public.jwt_campus_id()
    and public.is_student()
    and kind = 'broadcast'
    and student_user_id = auth.uid()
  );
