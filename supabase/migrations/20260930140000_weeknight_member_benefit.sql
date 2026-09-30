-- Explicit programming classification; never infer eligibility from a title,
-- category, calendar weekday or an old generic discount percentage.
-- Existing events and prices are unchanged until an authorized editor opts in.
begin;
alter table public.events
  add column if not exists is_weeknight_experience boolean not null default false;
comment on column public.events.is_weeknight_experience is
  'Eligible weeknight experience: active paid tiers receive at least 20% off ticket products in SDG checkout. Does not discount rentals, fees or grant admission.';
commit;
