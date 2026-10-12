-- One stored phone format across the platform.
--
-- Valid US/NANP numbers are stored as E.164 (+15125551234) no matter how they
-- were typed. Twilio Verify, Trial Pass matching and trial_passes_phone_idx
-- already rely on that exact string; this makes every other table agree and
-- guarantees it for writes from any client (web, mobile, Front Desk, RPCs).
-- The UI renders the stored value as +1 (512) 555-1234 via lib/phone.js.
--
-- Anything that is not a valid NANP number (international, wrong length, area
-- code or exchange starting with 0/1) is kept exactly as entered rather than
-- guessed into a wrong number. Blank and NULL are unchanged.
--
-- Mirrors normalizeStoredPhone() in lib/phone.js; keep the two in sync.

create or replace function public.normalize_us_phone(p text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case
    when p is null then null
    when btrim(p) = '' then p
    else coalesce(
      (select '+1' || d
         from (select case
                 when length(x) = 11 and left(x, 1) = '1' then substr(x, 2)
                 else x end as d
               from (select regexp_replace(p, '\D', '', 'g') as x) s) t
        where d ~ '^[2-9][0-9]{2}[2-9][0-9]{6}$'),
      btrim(p))
  end
$$;

create or replace function public.normalize_phone_column()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  new.phone := public.normalize_us_phone(new.phone);
  return new;
end
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'attendees', 'collaborations', 'contacts', 'early_member_applications',
    'free_accounts', 'guest_profiles', 'membership_applications',
    'micro_party_inquiries', 'signups', 'trial_passes', 'venue_inquiries'
  ] loop
    execute format('drop trigger if exists normalize_phone on public.%I', t);
    execute format(
      'create trigger normalize_phone before insert or update of phone on public.%I '
      'for each row execute function public.normalize_phone_column()', t);
  end loop;
end
$$;

-- One-time backfill. Format cleanup is not an edit, so the updated_at
-- triggers are paused while it runs and record timestamps stay truthful.
alter table public.contacts disable trigger contacts_updated_at;
alter table public.attendees disable trigger attendees_set_updated_at;
alter table public.trial_passes disable trigger trial_passes_set_updated_trg;

do $$
declare
  t text;
begin
  foreach t in array array[
    'attendees', 'collaborations', 'contacts', 'early_member_applications',
    'free_accounts', 'guest_profiles', 'membership_applications',
    'micro_party_inquiries', 'signups', 'trial_passes', 'venue_inquiries'
  ] loop
    execute format(
      'update public.%I set phone = public.normalize_us_phone(phone) '
      'where phone is distinct from public.normalize_us_phone(phone)', t);
  end loop;
end
$$;

alter table public.contacts enable trigger contacts_updated_at;
alter table public.attendees enable trigger attendees_set_updated_at;
alter table public.trial_passes enable trigger trial_passes_set_updated_trg;
