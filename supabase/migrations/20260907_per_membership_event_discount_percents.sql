-- Per-membership event discount overrides.
--
-- Historically an event had a single member_discount_percent that applied to
-- every member regardless of their plan. Now that we sell two very different
-- memberships (Weekender / cowork and Experience / iykyk), an event can offer
-- different discounts to each. NULL on the per-plan column falls back to the
-- legacy member_discount_percent, then to the category default.

alter table public.events
  add column if not exists member_discount_percent_cowork int
    check (member_discount_percent_cowork is null or (member_discount_percent_cowork between 0 and 100)),
  add column if not exists member_discount_percent_iykyk int
    check (member_discount_percent_iykyk is null or (member_discount_percent_iykyk between 0 and 100));

comment on column public.events.member_discount_percent_cowork is
  'Per-event member-discount override for The Weekender (cowork) plan. NULL falls back to member_discount_percent, then category default.';
comment on column public.events.member_discount_percent_iykyk is
  'Per-event member-discount override for the Experience (iykyk) plan. NULL falls back to member_discount_percent, then category default.';
