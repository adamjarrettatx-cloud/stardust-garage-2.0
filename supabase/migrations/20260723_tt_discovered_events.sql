-- =========================================================
-- TicketTailor Discovered Events Cache  (additive — safe to apply)
--
-- This migration is PURELY ADDITIVE:
--   * creates one new table (public.tt_discovered_events)
--   * adds RLS policies that reuse the existing public.is_admin()
-- It does NOT alter or drop any existing column, table, policy, or data. In
-- particular it does NOT touch public.events or public.event_ticket_metrics —
-- local-event metrics behavior is preserved exactly.
--
-- Purpose: the owner-only Financial Calendar shows income by event DATE, but it
-- was driven entirely by rows in public.events. Historical events that exist
-- ONLY in TicketTailor (never mirrored onto the website) therefore never
-- appeared. This table caches those TicketTailor events — discovered directly
-- from the read-only TT API (GET /v1/events + listOrders/listIssuedTickets) —
-- WITHOUT creating or publishing any public website event record.
--
-- One row per TicketTailor event SERIES (es_...), which is how the rest of this
-- codebase already models "an event" (one local event <-> one TT series; income
-- is pulled per series). The representative occurrence (ev_...) supplies the
-- title + date. `local_event_id` links back to public.events when a local event
-- already covers this series, so the calendar can de-duplicate and let the
-- existing event_ticket_metrics row win.
--
-- Money is stored in integer minor units (cents), matching TicketTailor,
-- lib/event-analytics.js, and public.event_ticket_metrics. No external
-- credentials are required to apply.
-- =========================================================

create table if not exists public.tt_discovered_events (
  id uuid primary key default gen_random_uuid(),

  -- Identity. The TicketTailor event series is the stable key (one row per
  -- series, matching how income is pulled). `tt_event_id` records the specific
  -- occurrence used for the title/date so the row is self-describing.
  tt_event_series_id text not null unique,
  tt_event_id        text,

  -- Discovered descriptive fields (from the TT event occurrence payload).
  title      text,
  event_date date,                    -- occurrence start_date.date (YYYY-MM-DD)
  start_at   timestamptz,             -- occurrence start_date.iso, when present
  currency   text,

  -- Core income metrics (integer counts / minor units) — same shape and units
  -- as public.event_ticket_metrics so the UI normalizes both identically.
  tickets_sold integer not null default 0,
  orders_count integer not null default 0,
  gross_cents  bigint  not null default 0,
  fees_cents   bigint  not null default 0,
  net_cents    bigint  not null default 0,

  -- Provenance + freshness. `pending` = discovered but income not yet pulled.
  source       text not null default 'tickettailor'
    check (source in ('tickettailor','placeholder')),
  status       text not null default 'pending'
    check (status in ('pending','ok','not_configured','error')),
  error_detail text,
  raw_summary  jsonb not null default '{}'::jsonb,

  -- Optional back-link to a local event that already represents this series.
  -- Nullable: TT-only historical events have no local record. ON DELETE SET
  -- NULL so removing a local event never deletes the discovered-income history.
  local_event_id uuid references public.events(id) on delete set null,

  fetched_at timestamptz,             -- when income was last refreshed
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tt_discovered_events_series_idx     on public.tt_discovered_events(tt_event_series_id);
create index if not exists tt_discovered_events_date_idx        on public.tt_discovered_events(event_date);
create index if not exists tt_discovered_events_fetched_at_idx  on public.tt_discovered_events(fetched_at);
create index if not exists tt_discovered_events_local_event_idx on public.tt_discovered_events(local_event_id);

-- Keep updated_at fresh on every write.
create or replace function public.tt_discovered_events_set_updated()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists tt_discovered_events_set_updated_trg on public.tt_discovered_events;
create trigger tt_discovered_events_set_updated_trg
before update on public.tt_discovered_events
for each row execute function public.tt_discovered_events_set_updated();

-- RLS: admin-only reads/writes, reusing the existing is_admin() definer
-- function (same policy shape as public.event_ticket_metrics). No public/anon
-- read policy — these are internal income figures. The service-role client
-- (cron + owner server components) bypasses RLS.
alter table public.tt_discovered_events enable row level security;

drop policy if exists tt_discovered_events_admin_select on public.tt_discovered_events;
drop policy if exists tt_discovered_events_admin_insert on public.tt_discovered_events;
drop policy if exists tt_discovered_events_admin_update on public.tt_discovered_events;
drop policy if exists tt_discovered_events_admin_delete on public.tt_discovered_events;
create policy tt_discovered_events_admin_select on public.tt_discovered_events for select to authenticated using (public.is_admin());
create policy tt_discovered_events_admin_insert on public.tt_discovered_events for insert to authenticated with check (public.is_admin());
create policy tt_discovered_events_admin_update on public.tt_discovered_events for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy tt_discovered_events_admin_delete on public.tt_discovered_events for delete to authenticated using (public.is_admin());
