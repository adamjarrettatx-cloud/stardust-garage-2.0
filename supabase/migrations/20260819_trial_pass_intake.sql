-- =========================================================
-- Trial SDG Pass — QR intake, 30-day trial window, door check-in
--
-- A first-time guest scans a printed QR code in the venue (bathroom stall
-- fliers, table cards, the front desk), gives three fields — full legal name,
-- mobile phone, email — and immediately gets back a scannable pass. That pass
-- opens a 30-day window in which they are expected to apply for membership;
-- while the window is open they get a nudge every six days, and at the door
-- their pass resolves to a live allow/deny decision rather than a piece of
-- paper staff have to interpret.
--
-- Three tables, all NEW. Nothing existing is altered, narrowed or dropped, so
-- the homepage signup form, the guest-list kiosk and the member discount cron
-- keep working exactly as they do today whether or not the app is deployed.
--
-- Deliberately separate from `guest_profiles` and `member_profiles`:
--   * guest_profiles is the venue's identity record for anyone who has ever
--     walked in (created at the door, carries the signed marketing consent).
--     A trial pass is a *credential with a clock on it*, and many trial passes
--     will belong to a guest we already have a profile for. The two are linked
--     by guest_profile_id rather than merged.
--   * member_profiles is a paid, authenticated member with a Stripe
--     subscription. A trial guest has no login and no subscription; jamming
--     them into member_profiles would corrupt every active-member count and
--     every discount-code query that reads it.
--
-- Everything here is written by server routes holding the service-role key.
-- RLS is enabled with admin-only SELECT and NO public/anon policy at all: the
-- public intake form posts to /api/trial-pass/create, it does not touch the
-- table directly, so there is no path by which a stranger can read the guest
-- list or enumerate pass tokens.
-- =========================================================

-- ---------------------------------------------------------------------------
-- 1. trial_passes — one row per person who completed the QR intake form.
--
-- qr_token_hash, not qr_token. The raw token is 256 bits of randomness that
-- rides in the pass URL encoded into the QR; it is shown to the guest exactly
-- once (on the success screen and in their email) and only its SHA-256 lands
-- here. Same reasoning as capacity_device_tokens: a leaked database dump must
-- not hand somebody a stack of working passes, and a high-entropy token needs
-- no salt to be safe under a plain cryptographic hash.
--
-- Two clocks, on purpose:
--   expires_at      — issued_at + 30 days. Never moves.
--   extended_until  — set only when staff grant the paid 7-day extension at
--                     the door. Null for everyone else.
-- The pass is live while now() < greatest(expires_at, coalesce(extended_until,
-- expires_at)); see effectiveExpiry() in lib/trial-pass.js, which is the one
-- place that rule is implemented for both the door and the reminder cron.
--
-- `status` is the account-level state. Check-ins are NOT statuses — a scan is
-- an event, and it gets its own row in trial_pass_checkins below.
-- ---------------------------------------------------------------------------
create table if not exists public.trial_passes (
  id uuid primary key default gen_random_uuid(),

  full_name text not null,
  email text not null,
  phone text not null,

  qr_token_hash text not null unique,

  status text not null default 'active'
    check (status in ('active', 'expired', 'extended', 'applied', 'converted')),

  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  extended_until timestamptz,
  extended_at timestamptz,
  extended_by uuid references public.team_members(id) on delete set null,

  -- Reminder bookkeeping. reminders_sent is the count of six-day nudges that
  -- have gone out (0-4 over a 30-day window); the cron uses it together with
  -- last_reminder_at to decide whether today is a send day, so a cron that
  -- runs twice cannot double-mail anyone.
  reminders_sent integer not null default 0,
  last_reminder_at timestamptz,
  pass_email_sent_at timestamptz,

  -- Lifecycle timestamps. applied_at is set when they submit a membership
  -- application; converted_at when that application turns into a paying
  -- member. Both stop the reminder sequence.
  applied_at timestamptz,
  converted_at timestamptz,

  -- Links out to the records this person may also appear in. Nullable and
  -- `on delete set null`: losing the link must never delete the trial history.
  guest_profile_id uuid references public.guest_profiles(id) on delete set null,
  member_profile_id uuid references public.member_profiles(id) on delete set null,
  application_id uuid references public.membership_applications(id) on delete set null,

  -- Where the intake happened, so we can tell a bathroom-stall flier from a
  -- front-desk iPad later without adding a table.
  source text not null default 'qr_intake',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One live pass per person. Case-folded because a guest typing
-- "Adam@Gmail.com" tonight and "adam@gmail.com" next month is one human, and
-- issuing them a second 30-day window would reset a trial that should have
-- ended. /api/trial-pass/create catches the conflict and re-sends the pass
-- they already have instead of erroring at them.
create unique index if not exists trial_passes_email_key
  on public.trial_passes (lower(email));

-- The reminder cron's working set: everybody whose window is still open.
create index if not exists trial_passes_open_window_idx
  on public.trial_passes (expires_at)
  where status in ('active', 'extended');

create index if not exists trial_passes_status_idx     on public.trial_passes (status);
create index if not exists trial_passes_created_at_idx on public.trial_passes (created_at desc);
create index if not exists trial_passes_guest_idx      on public.trial_passes (guest_profile_id);

-- ---------------------------------------------------------------------------
-- 2. trial_pass_checkins — every scan, allowed or denied.
--
-- Denials are recorded, not just successes. "How many people showed up on an
-- expired pass" is the number that tells Adam whether the 30-day window and
-- the $40 extension are priced right, and it is invisible if the door only
-- writes rows when it says yes.
--
-- event_id is nullable: a pass can be scanned at the front desk on a day with
-- no ticketed event on the calendar, and that scan is still worth keeping.
-- ---------------------------------------------------------------------------
create table if not exists public.trial_pass_checkins (
  id uuid primary key default gen_random_uuid(),

  trial_pass_id uuid not null references public.trial_passes(id) on delete cascade,
  event_id uuid references public.events(id) on delete set null,

  result text not null
    check (result in ('allowed', 'denied_expired', 'denied_ineligible_event', 'denied_duplicate')),

  checked_in_at timestamptz not null default now(),
  -- A team_members id, matching checked_in_by on event_guestlist_entries
  -- rather than the raw auth uid. Null when a door-device token did the scan.
  checked_in_by uuid references public.team_members(id) on delete set null,
  door_device_id uuid references public.capacity_device_tokens(id) on delete set null,
  notes text
);

create index if not exists trial_pass_checkins_pass_idx
  on public.trial_pass_checkins (trial_pass_id, checked_in_at desc);
create index if not exists trial_pass_checkins_event_idx
  on public.trial_pass_checkins (event_id, checked_in_at desc);

-- One allowed check-in per pass per event. A second scan of the same pass at
-- the same event is a duplicate (someone passed their phone back down the
-- line), and the door needs to see that rather than silently count them twice.
-- Partial so the denial rows, which repeat by nature, are unconstrained.
create unique index if not exists trial_pass_checkins_one_per_event
  on public.trial_pass_checkins (trial_pass_id, event_id)
  where result = 'allowed' and event_id is not null;

-- ---------------------------------------------------------------------------
-- 3. trial_pass_emails — the send log that makes the cron idempotent.
--
-- The reminder job runs daily on Vercel cron and may be retried; Resend has no
-- "did I already send this" query. So every send is claimed here FIRST, under
-- a unique constraint on (pass, kind, sequence), and only then handed to
-- Resend. A retry loses the insert race and skips the send instead of mailing
-- a guest twice.
--
-- sequence is the nudge number for kind='reminder' (1-4) and 0 for the
-- one-off kinds, so the constraint works without a nullable column in a
-- unique index.
-- ---------------------------------------------------------------------------
create table if not exists public.trial_pass_emails (
  id uuid primary key default gen_random_uuid(),

  trial_pass_id uuid not null references public.trial_passes(id) on delete cascade,

  kind text not null
    check (kind in ('pass_delivery', 'reminder', 'expiring_soon', 'expired', 'extended')),
  sequence integer not null default 0,

  created_at timestamptz not null default now(),
  sent_at timestamptz,
  provider_id text,
  error text
);

create unique index if not exists trial_pass_emails_unique_send
  on public.trial_pass_emails (trial_pass_id, kind, sequence);

create index if not exists trial_pass_emails_pass_idx
  on public.trial_pass_emails (trial_pass_id, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at bookkeeping, following the per-table trigger pattern used
-- elsewhere in this schema (potential_members_set_updated,
-- member_tickets_set_updated_at) rather than one shared generic function.
-- ---------------------------------------------------------------------------
create or replace function public.trial_passes_set_updated()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists trial_passes_set_updated_trg on public.trial_passes;
create trigger trial_passes_set_updated_trg
before update on public.trial_passes
for each row execute function public.trial_passes_set_updated();

-- ---------------------------------------------------------------------------
-- RLS — admin-only reads, no writes from any session.
--
-- Matching the 2026-07-27 hardening pass (membership_applications,
-- venue_inquiries, collaborations all sit on is_admin()). What is absent is
-- deliberate:
--
--   * No anon/public policy. The intake form is public, but it posts to a
--     server route; the table itself is not reachable from the browser. An
--     INSERT policy for `anon` here would let anyone mint unlimited passes
--     straight into the database, bypassing validation and rate limiting.
--   * No INSERT/UPDATE/DELETE policy for `authenticated`. Every write —
--     intake, door check-in, reminder bookkeeping, the staff extension — goes
--     through a route holding the service-role key, which bypasses RLS. A
--     door tablet carries a team session, not an admin one, and must not be
--     able to rewrite a pass's expiry directly.
--   * Door staff read a pass through /api/capacity/trial-pass/lookup, which
--     returns a masked, decision-shaped payload — never the row.
-- ---------------------------------------------------------------------------
alter table public.trial_passes        enable row level security;
alter table public.trial_pass_checkins enable row level security;
alter table public.trial_pass_emails   enable row level security;

drop policy if exists trial_passes_admin_select on public.trial_passes;
create policy trial_passes_admin_select on public.trial_passes
  for select to authenticated
  using (public.is_admin());

drop policy if exists trial_pass_checkins_admin_select on public.trial_pass_checkins;
create policy trial_pass_checkins_admin_select on public.trial_pass_checkins
  for select to authenticated
  using (public.is_admin());

drop policy if exists trial_pass_emails_admin_select on public.trial_pass_emails;
create policy trial_pass_emails_admin_select on public.trial_pass_emails
  for select to authenticated
  using (public.is_admin());
