import { ticketTailorFrozenResponse } from '@/lib/tickettailor-frozen';

export const runtime = 'nodejs';

// Ticket Tailor is retired. The discovered-event rows already in
// public.tt_discovered_events are the frozen historical record and are never
// re-pulled or overwritten. The nightly cron entry has been removed.
export async function POST() {
  return ticketTailorFrozenResponse();
}

export async function GET() {
  return ticketTailorFrozenResponse();
}
