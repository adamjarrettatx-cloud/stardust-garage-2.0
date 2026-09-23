import { NextResponse } from 'next/server';
import { payoutAccess } from '@/lib/artist-payout-server';
import { checkMercuryConnection, MercuryError } from '@/lib/mercury';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request) {
  const access = await payoutAccess(request, { write: false });
  if (access.response) return access.response;
  try {
    return NextResponse.json(await checkMercuryConnection(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const safe = error instanceof MercuryError ? error.message : 'Could not verify Mercury. No payment request was created.';
    return NextResponse.json({ error: safe }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
