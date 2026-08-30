-- Follow-up to 20260830_event_organizer_contract_workflow.
--
-- We're not adding a second column. Adam confirmed: an event has exactly ONE
-- counterparty slot, and that slot IS the Event Organizer. So this migration:
--
--   1. Adds a doc comment cementing `events.contact_id` as the Event Organizer
--      contact (previously ambiguous: "outside partner / contact").
--   2. Tags every contact currently in an event's organizer slot as
--      contact_type='event_organizer' (appended to whatever tags they already
--      have; never removes existing tags). Idempotent: skips contacts already
--      tagged.
-- Every change is guarded so re-running is a no-op. Any events accidentally
-- linked to the wrong Event Organizer can be corrected from the event edit
-- form — pick the right contact or flip to SDG-only.

comment on column public.events.contact_id is
  'Event Organizer contact for this event. Must be a contacts row tagged with contact_type=event_organizer. NULL means the event has no organizer set (permitted for SDG-only internal events).';

-- 2. Append 'event_organizer' to contact_type for every contact referenced by
--    an event.contact_id, only where not already tagged. array_append + distinct
--    keeps the ordering stable and prevents duplicate tags.
update public.contacts c
   set contact_type = array_append(c.contact_type, 'event_organizer')
 where c.id in (select distinct e.contact_id from public.events e where e.contact_id is not null)
   and not ('event_organizer' = any (coalesce(c.contact_type, array[]::text[])));

