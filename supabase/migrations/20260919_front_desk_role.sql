-- ---------------------------------------------------------------------------
-- front_desk role
-- ---------------------------------------------------------------------------
-- A hard-locked, single-purpose role introduced 2026-09-19 for the venue's
-- attended-entry laptop. Multiple front-of-house staff can each be given the
-- front_desk role and each get their own login, so every trial pass issued,
-- guest checked in, and capacity increment/decrement is audited to a specific
-- human via created_by / actor_id — rather than every attendant sharing one
-- generic account.
--
-- The role exists so that laptop's account CAN drive the guest-list check-in,
-- manual Trial Pass, capacity in/out, door-session start/end, and QR-scan
-- flows at /capacity/front-desk — and NOTHING else on the platform.
--
-- Model:
--   * It is NOT a team_members "team" role, and is_team() is deliberately
--     NOT extended to it. That means every RLS policy and every SECURITY
--     DEFINER RPC gated on is_team() / is_admin() / is_team_member()
--     continues to reject it. That is the whole point: extending is_team()
--     would silently re-open storage buckets, artist_pay, progress tracker,
--     team_events, chat, and everything else that already trusts is_team().
--   * The middleware and page-level gates treat this role as authorized ONLY
--     on /capacity/front-desk. Every other /capacity/* path (the two door
--     kiosk pages, /capacity/scan, /capacity/guest-list, /capacity/admin,
--     and the /capacity index) redirects it back to /capacity/front-desk.
--     All other authenticated areas (/bananas, /team/*, /member/*, /portal/*)
--     redirect it away as well.
--   * All privileged reads and writes that the front-desk page performs
--     ALREADY go through Next.js API routes using the service-role admin
--     client — see /api/capacity/checkins, /api/capacity/guestlist/*,
--     /api/team/trial-pass/*, /api/tickets/scan, /api/scan/member-id,
--     /api/door-session/*. Those routes are the only surface that needs to
--     be widened to admit front_desk; the underlying RLS policies do NOT
--     change and continue to reject the role's own credentials directly.
--   * The ONE exception is the +1 / -1 capacity RPCs. capacity_check_in and
--     capacity_check_out are SECURITY DEFINER functions that call auth.uid()
--     against the user-scoped client and gate on is_team(). They are
--     re-issued below to also accept is_front_desk(), so the actor_id
--     column on capacity_events keeps identifying WHICH front-desk staffer
--     tapped the button. capacity_adjust, capacity_reset, capacity_start_session,
--     and capacity_end_session are deliberately left untouched — the
--     front-desk page does not call them, and widening them would hand this
--     role reset/adjust powers it should not have.
--
-- The pattern mirrors 20260918_calendar_viewer_role.sql (which introduced
-- calendar_viewer) so the two hard-locked roles work the same way.
--
-- Rollback: drop is_front_desk(), revert capacity_check_in() and
-- capacity_check_out() to the is_team()-only gate from
-- 20260615_capacity_counter.sql, and restore the valid_role check to
-- ('admin','team','calendar_viewer').

-- 1. Expand the role check constraint.
ALTER TABLE public.team_members
  DROP CONSTRAINT IF EXISTS valid_role;

ALTER TABLE public.team_members
  ADD CONSTRAINT valid_role
  CHECK (role = ANY (ARRAY['admin'::text, 'team'::text, 'calendar_viewer'::text, 'front_desk'::text]));

-- 2. Helper predicate. SECURITY DEFINER so callers can invoke it without
--    recursing back into team_members' own policies (same pattern as
--    is_admin / is_team_member / is_calendar_viewer).
CREATE OR REPLACE FUNCTION public.is_front_desk()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members
    WHERE user_id = auth.uid()
      AND role = 'front_desk'
  );
$$;

REVOKE ALL ON FUNCTION public.is_front_desk() FROM public;
GRANT EXECUTE ON FUNCTION public.is_front_desk() TO authenticated;

-- 3. Widen the two capacity in/out RPCs so a front-desk user can operate the
--    +1/-1 buttons under their OWN identity. These are the only privileged
--    surfaces the front-desk page hits that call auth.uid() through a
--    user-scoped client rather than routing through the service-role admin
--    client; every other privileged front-desk action goes through an API
--    route with createAdminClient() and does not need its RLS widened.
--
--    Behaviour is byte-for-byte identical to the definitions in
--    20260615_capacity_counter.sql — same audit rows, same locking, same
--    error codes. Only the authorization guard changes from
--        if not public.is_team() then
--    to
--        if not (public.is_team() or public.is_front_desk()) then

CREATE OR REPLACE FUNCTION public.capacity_check_in(p_source text default 'front_door', p_note text default null)
RETURNS public.capacity_sessions LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth AS $$
DECLARE s public.capacity_sessions;
BEGIN
  IF NOT (public.is_team() OR public.is_front_desk()) THEN
    RAISE EXCEPTION 'Not authorized' USING errcode = '42501';
  END IF;
  s := public._capacity_lock_active();

  IF s.current_count >= s.max_capacity THEN
    INSERT INTO public.capacity_events(session_id, action, delta, count_after, max_capacity, actor_id, source, note)
      VALUES (s.id, 'blocked_full', 0, s.current_count, s.max_capacity, auth.uid(), COALESCE(p_source,'front_door'), p_note);
    RAISE EXCEPTION 'At capacity' USING errcode = 'P0001';
  END IF;

  UPDATE public.capacity_sessions
    SET current_count = current_count + 1
    WHERE id = s.id
    RETURNING * INTO s;

  INSERT INTO public.capacity_events(session_id, action, delta, count_after, max_capacity, actor_id, source, note)
    VALUES (s.id, 'check_in', 1, s.current_count, s.max_capacity, auth.uid(), COALESCE(p_source,'front_door'), p_note);
  RETURN s;
END; $$;

CREATE OR REPLACE FUNCTION public.capacity_check_out(p_source text default 'exit_door', p_note text default null)
RETURNS public.capacity_sessions LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth AS $$
DECLARE s public.capacity_sessions;
BEGIN
  IF NOT (public.is_team() OR public.is_front_desk()) THEN
    RAISE EXCEPTION 'Not authorized' USING errcode = '42501';
  END IF;
  s := public._capacity_lock_active();

  IF s.current_count <= 0 THEN
    INSERT INTO public.capacity_events(session_id, action, delta, count_after, max_capacity, actor_id, source, note)
      VALUES (s.id, 'blocked_empty', 0, s.current_count, s.max_capacity, auth.uid(), COALESCE(p_source,'exit_door'), p_note);
    RAISE EXCEPTION 'Already empty' USING errcode = 'P0001';
  END IF;

  UPDATE public.capacity_sessions
    SET current_count = current_count - 1
    WHERE id = s.id
    RETURNING * INTO s;

  INSERT INTO public.capacity_events(session_id, action, delta, count_after, max_capacity, actor_id, source, note)
    VALUES (s.id, 'check_out', -1, s.current_count, s.max_capacity, auth.uid(), COALESCE(p_source,'exit_door'), p_note);
  RETURN s;
END; $$;

-- Own team_members row read: the middleware and page gates look up
-- team_members.role after every request. The existing self-select policy
-- from 20260727_rls_security_hardening.sql (user_id = auth.uid(), no role
-- filter) already covers this case, so no new policy is required here.
