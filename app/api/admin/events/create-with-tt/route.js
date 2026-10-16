import { ticketTailorFrozenResponse } from '@/lib/tickettailor-frozen';

export const runtime = 'nodejs';

// Ticket Tailor is retired; new events are never created there.
export async function POST() {
  return ticketTailorFrozenResponse();
}
