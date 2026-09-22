import { handleMercuryPayout } from '@/lib/artist-payout-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(request, context) {
  return handleMercuryPayout(request, context);
}
