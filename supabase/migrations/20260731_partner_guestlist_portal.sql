-- =========================================================
-- Guest List — Phase 3 (partner portal: profile + guest list entry)
--
-- Phase 1 shipped the tables and the RLS that decides WHO may touch a row.
-- This migration adds the two things the partner-facing UI needs on top of
-- that, both of which are about WHAT a partner is allowed to end up with:
--
--   1. partner_grants() — the read side. A partner cannot select from
--      public.events, so the grants list needs a definer view to render.
--   2. A capacity trigger — the write side. RLS checks ownership of the grant
--      and nothing else, so without this a partner could add a thousand names
--      against a five-slot allocation.
-- =========================================================

-- ---------------------------------------------------------------------------
-- 1. partner_grants() — every allocation the calling partner holds, with the
--    event it belongs to and how much of it is already spent.
--
-- WHY a definer function instead of a join in the client:
--
--   * events is not readable by a partner. Its select policies are "published
--     AND visibility = public" for everyone, plus "everything" for is_team().
--     A partner is neither, so a grant for a draft event — which is exactly
--     when a promoter is filling their list, before the night is announced —
--     or for an internal micro-party would come back with a null event and
--     render as a card with no name and no date.
--   * the used counts have to agree with the trigger below. Computing them in
--     one place means the number the partner reads and the number the database
--     enforces cannot drift apart.
--
-- Definer, but not a privilege hole: the only rows it can return are the ones
-- whose contact_id matches partner_contact_id(), which is itself scoped to
-- auth.uid() and requires is_active. A staff member calling it gets nothing,
-- which is correct — they have the admin panel.
--
-- no_show entries are deliberately NOT counted. If someone on the list never
-- turned up, the spot went unused and the partner should be able to spend it
-- on somebody else; see the matching rule in the trigger.
-- ---------------------------------------------------------------------------
create or replace function public.partner_grants()
returns table (
  id uuid,
  event_id uuid,
  event_title text,
  event_date date,
  event_time text,
  total_slots int,
  free_slots int,
  discount_slots int,
  discount_detail text,
  notes text,
  free_used bigint,
  discount_used bigint
)
language sql stable security definer
set search_path = public, auth
as $$
  select
    g.id,
    g.event_id,
    e.title,
    e.event_date,
    e.event_time,
    g.total_slots,
    g.free_slots,
    g.discount_slots,
    g.discount_detail,
    g.notes,
    count(x.id) filter (where x.comp_type = 'free'     and x.status <> 'no_show'),
    count(x.id) filter (where x.comp_type = 'discount' and x.status <> 'no_show')
  from public.event_guestlist_grants g
  join public.events e on e.id = g.event_id
  left join public.event_guestlist_entries x on x.grant_id = g.id
  where g.contact_id = public.partner_contact_id()
  group by g.id, e.title, e.event_date, e.event_time;
$$;
revoke all on function public.partner_grants() from public;
grant execute on function public.partner_grants() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The capacity backstop.
--
-- The Phase 1 policies check public.partner_owns_grant(grant_id) and stop
-- there, because an RLS policy cannot count sibling rows without serializing
-- every insert on the table. The cap therefore has to live somewhere else, and
-- the API route alone is not enough:
--
--   * a check-then-insert in the route is two statements. Two of the partner's
--     own devices — or two taps on a slow phone — interleave between them and
--     both see "4 of 5 used".
--   * the route is not the only writer. RLS grants partners a direct INSERT on
--     event_guestlist_entries, so anyone who opens the network tab can post
--     straight to PostgREST with their own session and skip the route entirely.
--
-- So the rule is enforced here, next to the data, and the route's own check
-- exists only to turn a raised exception into a friendly message.
--
-- The FOR UPDATE on the grant row is what makes this actually atomic rather
-- than merely usually-correct: concurrent inserts against the same grant queue
-- behind that lock, so the second one counts the first one's row and refuses.
-- Locking the grant (rather than the entries) also means two partners filling
-- two different allocations never block each other.
-- ---------------------------------------------------------------------------
create or replace function public.event_guestlist_entries_enforce_capacity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_allowed int;
  v_used int;
begin
  -- A no_show does not occupy a spot, so adding one cannot overflow anything.
  if new.status = 'no_show' then
    return new;
  end if;

  select case new.comp_type when 'free' then g.free_slots else g.discount_slots end
    into v_allowed
    from public.event_guestlist_grants g
   where g.id = new.grant_id
     for update;

  if not found then
    raise exception 'Guest list allocation % does not exist', new.grant_id
      using errcode = 'GL404';
  end if;

  select count(*)
    into v_used
    from public.event_guestlist_entries x
   where x.grant_id = new.grant_id
     and x.comp_type = new.comp_type
     and x.status <> 'no_show';

  if v_used >= v_allowed then
    raise exception
      'Guest list allocation % has no % spots left (% of % used)',
      new.grant_id, new.comp_type, v_used, v_allowed
      using errcode = 'GL409';
  end if;

  return new;
end;
$$;

-- INSERT only, on purpose. An UPDATE trigger would also fire on the door
-- kiosk's pending -> checked_in transition (Phase 5), which does not change how
-- many spots are occupied but would still have to pass the count, and a
-- re-instated no_show would be blocked at the door rather than at the point
-- someone chose to add the name. Adding names is the only path a partner has
-- into this table, and it is the path this guards.
drop trigger if exists event_guestlist_entries_enforce_capacity_trg
  on public.event_guestlist_entries;
create trigger event_guestlist_entries_enforce_capacity_trg
before insert on public.event_guestlist_entries
for each row execute function public.event_guestlist_entries_enforce_capacity();

-- The count above is the trigger's hot path and runs while holding a lock on
-- the grant, so keep it off a sequential scan as lists grow.
create index if not exists event_guestlist_entries_grant_comp_status_idx
  on public.event_guestlist_entries(grant_id, comp_type, status);
