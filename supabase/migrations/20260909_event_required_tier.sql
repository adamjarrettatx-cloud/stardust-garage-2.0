-- Adds a required-membership-tier gate to events, so an event can be
-- restricted to a specific membership tier (Insider Experience, Weekender,
-- etc.) beyond the existing broad is_sdg_only members-vs-public gate.
--
-- Values:
--   NULL   -- no tier requirement (default, current behavior)
--   'cowork' -- Weekender members only
--   'iykyk'  -- Experience (Insider) members only
--
-- The notification broadcaster reads this column to auto-scope the audience
-- when an event is published. If NULL and is_sdg_only=false -> all users. If
-- NULL and is_sdg_only=true -> all members. If set -> only members with that
-- exact subscription_plan value.
--
-- Kept as a plain text column (not an enum) so future tiers can be added
-- without a schema migration. Application code is the source of truth for
-- which tier keys are valid (see lib/event-visibility.js MEMBER_TIER_DISPLAY).

alter table public.events
  add column if not exists required_membership_tier text default null;

comment on column public.events.required_membership_tier is
  'When set, only members whose subscription_plan matches this value can access the event. Used by the notification broadcaster and (future) the /events/[slug] gate. NULL means no tier requirement.';

-- Cheap filtered index for the broadcaster's "give me all events requiring
-- tier X in the next 30 days" scan.
create index if not exists idx_events_required_tier
  on public.events (required_membership_tier)
  where required_membership_tier is not null;
