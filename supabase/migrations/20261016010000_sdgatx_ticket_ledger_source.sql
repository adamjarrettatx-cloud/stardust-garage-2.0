-- Split sdgatx.com ticket revenue from the frozen Ticket Tailor record in the
-- Cash Flow ledger.
--
-- The retired "Sync TicketTailor" button mirrored EVERY event's cached sales
-- into financial_transactions with source='tickettailor', including
-- first-party (internal) events. This moves those rows to source='sdgatx' on a
-- new "sdgatx.com (Stripe)" account, refreshes them from the current metrics
-- cache, and adds any internal events that were never mirrored. Ticket Tailor
-- rows for Ticket Tailor-linked events are untouched. No rows are deleted.

insert into public.financial_accounts (name, account_type)
values ('sdgatx.com (Stripe)', 'ticketing')
on conflict (name) do nothing;

-- 1. Relabel mislabeled first-party rows.
update public.financial_transactions f
set source = 'sdgatx',
    account_id = (select id from public.financial_accounts where name = 'sdgatx.com (Stripe)'),
    metadata = f.metadata - 'tt_event_series_id',
    updated_at = now()
from public.events e
where f.source = 'tickettailor'
  and f.linked_event_id = e.id
  and e.ticketing_mode = 'internal'
  and e.tt_event_series_id is null;

-- 2. Bring relabeled rows up to the current cached figures.
update public.financial_transactions f
set amount = round(greatest(m.gross_cents, 0)::numeric / 100, 2),
    transaction_date = e.event_date,
    metadata = f.metadata || jsonb_build_object(
      'event_title', e.title,
      'gross_cents', m.gross_cents,
      'fees_cents', m.fees_cents,
      'net_cents', m.net_cents,
      'tickets_sold', m.tickets_sold,
      'orders_count', m.orders_count,
      'metrics_fetched_at', m.fetched_at),
    updated_at = now()
from public.events e
join public.event_ticket_metrics m on m.event_id = e.id
where f.source = 'sdgatx'
  and f.external_ref = e.id::text
  and m.source = 'internal'
  and m.status = 'ok';

-- 3. Add first-party events with sales that were never mirrored.
insert into public.financial_transactions
  (account_id, transaction_date, amount, direction, txn_type, category, source, external_ref, linked_event_id, metadata)
select
  (select id from public.financial_accounts where name = 'sdgatx.com (Stripe)'),
  e.event_date,
  round(m.gross_cents::numeric / 100, 2),
  'in', 'operating', 'Ticket Revenue', 'sdgatx', e.id::text, e.id,
  jsonb_build_object(
    'event_title', e.title,
    'gross_cents', m.gross_cents,
    'fees_cents', m.fees_cents,
    'net_cents', m.net_cents,
    'tickets_sold', m.tickets_sold,
    'orders_count', m.orders_count,
    'metrics_fetched_at', m.fetched_at)
from public.events e
join public.event_ticket_metrics m on m.event_id = e.id
where e.ticketing_mode = 'internal'
  and e.tt_event_series_id is null
  and e.event_date is not null
  and m.source = 'internal'
  and m.status = 'ok'
  and m.gross_cents > 0
  and not exists (
    select 1 from public.financial_transactions f
    where f.source = 'sdgatx' and f.external_ref = e.id::text
  );
