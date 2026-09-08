-- Add a third events.visibility value: 'unlisted'.
--
-- Recap of the existing model (see 20260616_event_visibility_micro_party.sql
-- and 20260727_rls_security_hardening.sql):
--   * visibility = 'public'   → shown on the public /events list, /home,
--                               the anon-visible calendar, member surfaces,
--                               and the /events/[slug] detail page.
--   * visibility = 'internal' → hidden from every public/anon surface; only
--                               team+admin can see it. Detail page 404s.
--
-- 'unlisted' is a shareable-by-link tier that sits between the two. The
-- /events/[slug] detail page renders for anyone with the URL (so ticket
-- checkout works for beta testers, invited guests, and private-rental
-- attendees), but every LISTING surface — /events, /home, the public
-- calendar — keeps its existing `.eq('visibility', 'public')` filter and
-- therefore never surfaces the event unless the visitor already has the
-- slug. The event detail page also emits a `noindex` robots directive so
-- search engines don't crawl unlisted URLs into their index.
--
-- Two things need to change server-side to make this safe:
--   1. The CHECK constraint on events.visibility, which currently only
--      allows ('public', 'internal').
--   2. The anon RLS SELECT policy on public.events, which currently only
--      returns rows where visibility = 'public'. It must also return rows
--      where visibility = 'unlisted' so the anon detail-page query can
--      resolve the row by slug. Team/admin already see everything via the
--      separate "Team can view all events" policy — no change needed there.
--
-- No data changes: every existing row keeps its current visibility. New rows
-- still default to 'public'.

-- 1. Extend the CHECK constraint.
alter table public.events
  drop constraint if exists events_visibility_check;

alter table public.events
  add constraint events_visibility_check
  check (visibility in ('public', 'internal', 'unlisted'));

-- 2. Broaden the anon read policy to include unlisted events.
--
-- Anon still cannot see drafts or internal events, and this policy is the
-- only one that grants public/anon access — listings are filtered at the
-- query level, so widening this policy does not cause unlisted rows to
-- appear on /events or /home.
drop policy if exists "Public can view published public events" on public.events;

create policy "Public can view published public or unlisted events" on public.events
  for select to public
  using (status = 'published' and visibility in ('public', 'unlisted'));
