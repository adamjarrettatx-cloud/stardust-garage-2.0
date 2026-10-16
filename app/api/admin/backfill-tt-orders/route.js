import { ticketTailorFrozenResponse } from '@/lib/tickettailor-frozen';

export const runtime = 'nodejs';

// Ticket Tailor is retired; order backfills no longer run.
export async function POST() {
  return ticketTailorFrozenResponse();
}
