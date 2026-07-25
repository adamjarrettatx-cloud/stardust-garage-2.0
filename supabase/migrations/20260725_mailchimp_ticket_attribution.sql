-- =========================================================
-- Mailchimp <-> Ticket Tailor purchase attribution  (additive — safe to apply)
--
-- Purpose: answer "did this email campaign actually drive a ticket sale?" for
-- a site where checkout happens entirely on Ticket Tailor's own domain, not
-- ours. Two pieces:
--
--   * marketing_email_clicks — every time someone lands on sdgatx.com with a
--     Mailchimp click-tracking id (mc_cid/mc_eid) in the URL, we log it here
--     (email resolved via the Mailchimp API). This is our record of "who
--     clicked, from which campaign, and when."
--
--   * ticket_order_attribution — every completed Ticket Tailor order, matched
--     back to the most recent click from the same email (if any) within a
--     lookback window, and the result of syncing that order into Mailchimp's
--     ecommerce API as revenue attributed to that campaign.
--
-- This migration is PURELY ADDITIVE. It does not alter any existing table.
-- Both tables are OWNER-ONLY to read (mirrors manual_income_entries); all
-- writes happen server-side via the service-role client (webhook + click
-- logger), so no INSERT/UPDATE policies are needed for authenticated users.
-- =========================================================

create table if not exists public.marketing_email_clicks (
  id uuid primary key default gen_random_uuid(),

  -- Resolved via the Mailchimp API from mc_eid. Null if the lookup missed
  -- (e.g. an old/expired tracking id) — the click is still logged for volume
  -- visibility even without an email match.
  email text check (email is null or char_length(email) <= 320),

  -- Mailchimp's campaign id and per-recipient click id, straight off the URL.
  mc_cid text,
  mc_eid text,
  campaign_title text,

  landing_path text not null check (char_length(landing_path) <= 500),
  user_agent text check (user_agent is null or char_length(user_agent) <= 500),

  created_at timestamptz not null default now()
);

create index if not exists marketing_email_clicks_email_idx      on public.marketing_email_clicks (lower(email));
create index if not exists marketing_email_clicks_mc_cid_idx     on public.marketing_email_clicks (mc_cid);
create index if not exists marketing_email_clicks_created_at_idx on public.marketing_email_clicks (created_at desc);

alter table public.marketing_email_clicks enable row level security;

drop policy if exists marketing_email_clicks_owner_select on public.marketing_email_clicks;
create policy marketing_email_clicks_owner_select on public.marketing_email_clicks
  for select to authenticated using (public.is_owner());

-- ---------------------------------------------------------------------------

create table if not exists public.ticket_order_attribution (
  id uuid primary key default gen_random_uuid(),

  -- Ticket Tailor's order id. Unique so repeated webhook deliveries
  -- (order.created followed by order.updated, or a retried delivery) upsert
  -- the same row instead of duplicating it.
  tt_order_id text not null unique,
  tt_event_id text,

  -- Local event this order belongs to, when we can match it. Nullable + SET
  -- NULL on delete so removing an event never deletes the money record.
  local_event_id uuid references public.events(id) on delete set null,

  buyer_email text check (buyer_email is null or char_length(buyer_email) <= 320),
  total_paid_cents bigint not null default 0 check (total_paid_cents >= 0),
  currency text not null default 'USD',

  -- Ticket Tailor order status at the time we last processed it
  -- (completed / cancelled / pending, etc.) — free text, not an enum, so a
  -- new TT status value never breaks ingestion.
  status text check (status is null or char_length(status) <= 64),

  -- Attribution match, if any.
  matched_mc_cid text,
  matched_click_id uuid references public.marketing_email_clicks(id) on delete set null,

  -- Mailchimp ecommerce sync outcome, for observability/debugging.
  mailchimp_synced boolean not null default false,
  mailchimp_sync_error text,

  -- Full Ticket Tailor order object as received, for debugging/replay if a
  -- Mailchimp sync needs to be manually re-driven later.
  raw_payload jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ticket_order_attribution_email_idx      on public.ticket_order_attribution (lower(buyer_email));
create index if not exists ticket_order_attribution_event_idx      on public.ticket_order_attribution (local_event_id);
create index if not exists ticket_order_attribution_created_at_idx on public.ticket_order_attribution (created_at desc);

create or replace function public.ticket_order_attribution_set_updated()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists ticket_order_attribution_set_updated_trg on public.ticket_order_attribution;
create trigger ticket_order_attribution_set_updated_trg
before update on public.ticket_order_attribution
for each row execute function public.ticket_order_attribution_set_updated();

alter table public.ticket_order_attribution enable row level security;

drop policy if exists ticket_order_attribution_owner_select on public.ticket_order_attribution;
create policy ticket_order_attribution_owner_select on public.ticket_order_attribution
  for select to authenticated using (public.is_owner());
