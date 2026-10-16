import { ticketTailorFrozenResponse } from '@/lib/tickettailor-frozen';

export const runtime = 'nodejs';

// Ticket Tailor is retired. Its Cash Flow rows (source='tickettailor') are the
// final record and are no longer re-synced. sdgatx.com ticket revenue is
// mirrored automatically by /api/admin/refresh-event-metrics.
export async function POST() {
  return ticketTailorFrozenResponse();
}
