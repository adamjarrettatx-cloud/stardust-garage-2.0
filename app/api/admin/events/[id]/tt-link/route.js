import { ticketTailorFrozenResponse } from '@/lib/tickettailor-frozen';

export const runtime = 'nodejs';

// Ticket Tailor links are frozen; legacy events keep their existing series id.
export async function POST() {
  return ticketTailorFrozenResponse();
}
