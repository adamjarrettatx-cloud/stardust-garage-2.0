-- =========================================================
-- Event Ticket Metrics — allow internal-ticketing source
--
-- The event_ticket_metrics cache was created when TicketTailor was the only
-- source of live ticket sales. Now that /api/tickets + public.orders is the
-- first-party ticketing system (events.ticketing_mode = 'internal'), the
-- cache needs to accept snapshots computed from our own orders/tickets rows,
-- not just TicketTailor pulls, so the same row/route/component can serve
-- both providers on the Events list.
--
-- Purely additive:
--   * relaxes the source CHECK to allow 'internal' in addition to
--     'tickettailor', 'manual', 'placeholder'
--   * no columns added or dropped, no data rewritten
--   * safe to re-run (drops + recreates the same-named constraint)
--
-- The refresh route decides which source to write:
--   ticketing_mode='internal'  → aggregate orders/tickets locally, source='internal'
--   tt_event_series_id present → existing TicketTailor pull, source='tickettailor'
--   neither                    → placeholder row, source='placeholder'
-- =========================================================

alter table public.event_ticket_metrics
  drop constraint if exists event_ticket_metrics_source_check;

alter table public.event_ticket_metrics
  add constraint event_ticket_metrics_source_check
  check (source in ('tickettailor', 'internal', 'manual', 'placeholder'));
