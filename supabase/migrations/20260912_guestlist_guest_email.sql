-- Guest-list invite email flow
--
-- Adds guest_email + invite_token to event_guestlist_entries so partners can
-- send named guests a "you're on the list" email. The token is the URL slug
-- for /g/<token>, the landing page that walks a first-time guest through
-- profile completion and app install.
--
-- Both columns are nullable to keep every historical row valid. New entries
-- created after this migration are required by the API to include guest_email;
-- the token is minted server-side on insert via a BEFORE trigger.

alter table public.event_guestlist_entries
  add column if not exists guest_email  text,
  add column if not exists invite_token text;

-- Stored lowercased so lookups are case-insensitive without a functional index.
alter table public.event_guestlist_entries
  add constraint event_guestlist_entries_guest_email_lower_ck
  check (guest_email is null or guest_email = lower(guest_email));

-- Unique token per row. Nullable so the constraint doesn't fire on legacy rows;
-- the trigger below stamps a token on every fresh insert.
create unique index if not exists event_guestlist_entries_invite_token_uidx
  on public.event_guestlist_entries (invite_token)
  where invite_token is not null;

-- Non-unique index on lowered email for the "have they signed up yet?" lookup
-- run when a door scans a QR that resolves to a free_accounts row.
create index if not exists event_guestlist_entries_guest_email_idx
  on public.event_guestlist_entries (guest_email);

-- Mint an invite_token when one wasn't supplied. 24 base64url-ish chars from
-- 18 random bytes = ~144 bits of entropy, plenty for an unguessable slug that
-- still fits on a printable QR and reads reasonably in an email link.
create or replace function public.event_guestlist_entries_mint_invite_token()
returns trigger
language plpgsql
as $$
begin
  if new.invite_token is null then
    new.invite_token := replace(replace(replace(
      encode(gen_random_bytes(18), 'base64'),
      '+', '-'), '/', '_'), '=', '');
  end if;
  if new.guest_email is not null then
    new.guest_email := lower(trim(new.guest_email));
  end if;
  return new;
end
$$;

drop trigger if exists trg_event_guestlist_entries_mint_token on public.event_guestlist_entries;
create trigger trg_event_guestlist_entries_mint_token
  before insert on public.event_guestlist_entries
  for each row execute function public.event_guestlist_entries_mint_invite_token();

comment on column public.event_guestlist_entries.guest_email is
  'Lowercased email address the invite was sent to. Nullable for legacy rows.';
comment on column public.event_guestlist_entries.invite_token is
  'Opaque URL slug for /g/<token>, the landing page that walks the guest through profile completion and app install.';
