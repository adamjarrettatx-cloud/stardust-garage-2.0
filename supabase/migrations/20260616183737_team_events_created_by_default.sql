-- Ensure team_events.created_by is automatically populated with the
-- authenticated user's uid on insert. This makes the RLS INSERT policy
-- (is_team_member() AND created_by = auth.uid()) pass correctly even
-- when the client does not explicitly send created_by.
ALTER TABLE public.team_events ALTER COLUMN created_by SET DEFAULT auth.uid();
