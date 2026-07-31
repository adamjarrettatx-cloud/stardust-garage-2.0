-- Lets a Team Calendar entry (team_events) be linked to an actual site event
-- (events table), so admins/team can connect a calendar item to the real
-- event it's about (past or upcoming). Nullable + ON DELETE SET NULL so
-- deleting the underlying event never breaks the calendar entry.
ALTER TABLE public.team_events
  ADD COLUMN linked_event_id uuid REFERENCES public.events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS team_events_linked_event_id_idx
  ON public.team_events (linked_event_id)
  WHERE linked_event_id IS NOT NULL;
