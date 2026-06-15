-- =========================================================
-- Event Ticket Metrics Cache  (additive — safe to apply)
--
-- This migration is PURELY ADDITIVE:
--   * creates one new table (public.event_ticket_metrics)
--   * adds RLS policies that reuse the existing public.is_admin()
-- It does NOT alter or drop any existing column, table, or policy data.
--
-- Purpose: cache a per-event snapshot of TicketTailor sales/performance
-- numbers so the admin analytics dashboard renders fast, real figures
-- without hitting the TicketTailor API on every page load (rate-limit safe).
-- A read-only cron/admin route (/api/admin/refresh-event-metrics) populates
-- this table by calling the existing READ-ONLY helpers in lib/tickettailor.js
-- (listOrders / listIssuedTickets / getEventSeries). Nothing here ever writes
-- back to TicketTailor.
--
-- Money is stored in integer minor units (cents), matching TicketTailor and
-- lib/event-analytics.js. No external credentials are required to apply.
-- =========================================================

create table if not exists public.event_ticket_metrics (
  id uuid primary key default gen_random_uuid(),

  -- One cached metrics row per local event. Cascades if the event is removed.
  event_id uuid not null unique
    references public.events(id) on delete cascade,

  -- The TicketTailor event series this snapshot was pulled from, copied at
  -- fetch time so the row is self-describing even if events.tt_event_series_id
  -- later changes. Nullable when an event is not yet TT-linked.
  tt_event_series_id text,

  -- Core sales metrics (integer counts / minor units).
  tickets_sold  integer not null default 0,
  orders_count  integer not null default 0,
  gross_cents   bigint  not null default 0,
  fees_cents    bigint  not null default 0,
  net_cents     bigint  not null default 0,

  -- Attendance / check-in counts. TicketTailor exposes check-in data on some
  -- plans; left nullable until that pull is implemented so "unknown" is
  -- distinguishable from a real zero.
  attendees_count integer,
  checkins_count  integer,

  -- Provenance + freshness.
  source     text not null default 'tickettailor'
    check (source in ('tickettailor','manual','placeholder')),
  fetched_at timestamptz,            -- when the snapshot was last refreshed
  status     text not null default 'pending'
    check (status in ('pending','ok','not_configured','error')),
  error_detail text,                 -- last refresh error, if any

  -- Optional raw rollup returned by the refresh job (ticketsByType, etc.) so
  -- the UI can show a breakdown without another query.
  raw_summary jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists event_ticket_metrics_event_id_idx   on public.event_ticket_metrics(event_id);
create index if not exists event_ticket_metrics_series_idx      on public.event_ticket_metrics(tt_event_series_id);
create index if not exists event_ticket_metrics_fetched_at_idx  on public.event_ticket_metrics(fetched_at);

-- Keep updated_at fresh on every write.
create or replace function public.event_ticket_metrics_set_updated()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists event_ticket_metrics_set_updated_trg on public.event_ticket_metrics;
create trigger event_ticket_metrics_set_updated_trg
before update on public.event_ticket_metrics
for each row execute function public.event_ticket_metrics_set_updated();

-- RLS: admin-only reads/writes, reusing the existing is_admin() definer
-- function. There is NO public/anon read policy — these figures are internal.
-- The service-role client (cron + admin server components) bypasses RLS, so
-- the refresh job and dashboard work without a per-policy carve-out.
alter table public.event_ticket_metrics enable row level security;

drop policy if exists event_ticket_metrics_admin_select on public.event_ticket_metrics;
drop policy if exists event_ticket_metrics_admin_insert on public.event_ticket_metrics;
drop policy if exists event_ticket_metrics_admin_update on public.event_ticket_metrics;
drop policy if exists event_ticket_metrics_admin_delete on public.event_ticket_metrics;
create policy event_ticket_metrics_admin_select on public.event_ticket_metrics for select to authenticated using (public.is_admin());
create policy event_ticket_metrics_admin_insert on public.event_ticket_metrics for insert to authenticated with check (public.is_admin());
create policy event_ticket_metrics_admin_update on public.event_ticket_metrics for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy event_ticket_metrics_admin_delete on public.event_ticket_metrics for delete to authenticated using (public.is_admin());
