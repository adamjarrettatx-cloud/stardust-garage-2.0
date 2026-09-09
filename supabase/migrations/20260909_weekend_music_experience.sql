-- The Weekender ($48/mo) tier's flagship benefit is 25% off "Weekend Music
-- Experiences" — Friday–Sunday music events. Rather than trying to auto-derive
-- that from category + date (fragile: a Friday yoga class isn't a music
-- experience, and a Wednesday live-music night is), admins flag qualifying
-- events explicitly via this boolean.
--
-- The Weekender discount resolver (lib/discountPercentResolver.js) checks
-- this flag: when true, Weekender members get 25% off; when false, they get
-- no member discount on that event (Weekender is a weekend-music tier, not
-- a general discount tier).

alter table public.events
  add column if not exists is_weekend_music_experience boolean not null default false;

comment on column public.events.is_weekend_music_experience is
  'When true, Weekender-tier members get 25% off tickets to this event. Set by admin per event; no auto-derivation from category/date.';

-- Partial index: only rows where the flag is true. Keeps the index tiny and
-- makes the "list qualifying events" queries the resolver + calendar might
-- run cheap.
create index if not exists idx_events_weekend_music_experience
  on public.events (event_date)
  where is_weekend_music_experience = true;
