// Ticket Tailor is retired. Its historical sales stay in the database as a
// frozen record (event_ticket_metrics, tt_discovered_events, ledger rows), but
// nothing on the site pulls from, pushes to, or relinks Ticket Tailor anymore.
import { NextResponse } from 'next/server';

export const TICKETTAILOR_FROZEN_MESSAGE =
  'Ticket Tailor is retired. Past Ticket Tailor sales are kept as a frozen record and are no longer synced.';

export function ticketTailorFrozenResponse() {
  return NextResponse.json({ error: TICKETTAILOR_FROZEN_MESSAGE, frozen: true }, { status: 410 });
}
