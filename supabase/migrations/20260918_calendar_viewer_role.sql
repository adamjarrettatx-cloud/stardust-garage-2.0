-- ---------------------------------------------------------------------------
-- calendar_viewer role
-- ---------------------------------------------------------------------------
-- A hard-locked, read-only role introduced 2026-09-18 for a specific
-- team_members row (David Hajj) whose admin trust was revoked. The role is
-- deliberately narrow:
--
--   * It is NOT a team_members "team" role. is_team_member() still returns
--     false for it, so every RLS policy that gates writes (or reads) on
--     is_team_member()/is_admin() continues to reject it. That means no team
--     chat, no team_events writes, no member profile reads, no partner data,
--     no admin data — nothing.
--   * It gets ONE thing: SELECT on team_events. Combined with the existing
--     "Public can view published public events" policy on events, that is
--     enough to render the Events Calendar in read-only mode and nothing
--     else. Public events are already publicly readable, so no new policy is
--     needed there.
--   * All UI gates and the middleware handle this role explicitly. See
--     middleware.js and lib/auth-helpers.js.
--
-- Rollback: drop the SELECT policy, drop is_calendar_viewer(), and restore
-- the valid_role check to ('admin','team').

-- 1. Expand the role enum-ish check constraint.
ALTER TABLE public.team_members
  DROP CONSTRAINT IF EXISTS valid_role;

ALTER TABLE public.team_members
  ADD CONSTRAINT valid_role
  CHECK (role = ANY (ARRAY['admin'::text, 'team'::text, 'calendar_viewer'::text]));

-- 2. Helper predicate. SECURITY DEFINER so RLS can call it without recursing
--    back into team_members' own policies (same pattern as is_admin /
--    is_team_member).
CREATE OR REPLACE FUNCTION public.is_calendar_viewer()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members
    WHERE user_id = auth.uid()
      AND role = 'calendar_viewer'
  );
$$;

REVOKE ALL ON FUNCTION public.is_calendar_viewer() FROM public;
GRANT EXECUTE ON FUNCTION public.is_calendar_viewer() TO authenticated;

-- 3. Read-only SELECT on team_events for calendar viewers. This is the ONLY
--    grant they receive on any operational table. Writes are already blocked
--    because the existing INSERT/UPDATE/DELETE policies require
--    is_admin() or (is_team_member() AND created_by = auth.uid()), and this
--    role is neither.
DROP POLICY IF EXISTS "Calendar viewers can read team events" ON public.team_events;
CREATE POLICY "Calendar viewers can read team events"
  ON public.team_events
  FOR SELECT
  TO authenticated
  USING (public.is_calendar_viewer());

-- 4. Let a calendar viewer read their OWN team_members row, same shape as
--    the existing "own row" access other roles rely on. Without this, the
--    server-side role check in middleware/loadEventsCalendarData would
--    return no row and the account would look logged-out.
--    (Adjust if a more restrictive own-row policy already covers this; the
--    existing self-select policy in 20260727_rls_security_hardening.sql
--    uses user_id = auth.uid() with no role filter and already covers this
--    case, so no new policy is strictly required. This block is left as a
--    no-op comment for the audit trail.)
