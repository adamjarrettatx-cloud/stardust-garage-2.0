import { ticketTailorFrozenResponse } from '@/lib/tickettailor-frozen';

export const runtime = 'nodejs';

// Ticket Tailor is retired; the series list is no longer fetched.
export async function GET() {
  return ticketTailorFrozenResponse();
}
