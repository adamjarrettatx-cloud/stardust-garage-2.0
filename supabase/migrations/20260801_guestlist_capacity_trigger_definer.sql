-- =========================================================
-- Guest List — run the capacity trigger as its definer
--
-- BUG: every add-guest from the partner portal failed with "Could not add that
-- guest.", for both free and discounted entries, including on events with most
-- of the allocation still unspent.
--
-- public.event_guestlist_entries_enforce_capacity(), added in
-- 20260731_partner_guestlist_portal.sql, was created without SECURITY DEFINER.
-- A plpgsql trigger function without it runs as whoever fired the insert, so
-- RLS applies to the statements inside the function body. Its first statement
-- is the lock:
--
--     select ... from public.event_guestlist_grants g
--      where g.id = new.grant_id
--        for update;
--
-- PostgreSQL applies the UPDATE policies' USING expressions, on top of the
-- SELECT ones, to any row a SELECT ... FOR UPDATE tries to lock — locking a row
-- you could not update is not allowed. A partner has "Partners can view their
-- own grants" (SELECT) and, deliberately, no UPDATE policy at all: how many
-- slots you get is not yours to decide. The default-deny UPDATE filter
-- therefore removed the row, the lookup came back empty, and the trigger raised
-- GL404 "allocation does not exist" for an allocation that exists and has room.
-- The route only translates GL409 into a friendly message, so everything else
-- fell through to the generic failure the promoter saw.
--
-- WHY IT SURVIVED TESTING: team members hold "Team can update grants", so the
-- lock succeeds for them, and the admin panel and the door kiosk write with the
-- service-role key, which bypasses RLS entirely. The partner portal is the only
-- caller that reaches this trigger through a restricted session, and it was the
-- only path that broke.
--
-- THE FIX: SECURITY DEFINER. A capacity backstop has to lock the grant and
-- count every sibling entry regardless of what the caller may read — that is
-- the whole reason the rule lives next to the data instead of in the route.
-- Giving partners an UPDATE policy on event_guestlist_grants would also unblock
-- the lock, but it would hand them their own allocation to edit, which is the
-- opposite of what this table's policies are for.
--
-- NOT A PRIVILEGE HOLE: the function takes no arguments and is reachable only
-- as a BEFORE INSERT trigger on event_guestlist_entries. It reads only the
-- grant named by the row being inserted, returns NEW unchanged or raises, and
-- hands no data back to the caller. The check that decides whether this partner
-- may insert against this grant at all — partner_owns_grant(grant_id) in the
-- "Partners can add their own entries" policy — still runs on the statement
-- itself, before the trigger is reached. search_path stays pinned, as on every
-- other definer function in this feature.
--
-- The body is otherwise unchanged from the Phase 3 version, and the existing
-- trigger keeps pointing at it: CREATE OR REPLACE FUNCTION replaces the
-- definition in place, so event_guestlist_entries_enforce_capacity_trg does not
-- need to be recreated.
-- =========================================================

create or replace function public.event_guestlist_entries_enforce_capacity()
returns trigger
language plpgsql
security definer
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
