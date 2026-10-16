import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Ticket Tailor is retired. Any late webhook delivery is acknowledged with 200
// so Ticket Tailor stops retrying, and nothing is read, written, or forwarded.
// Past Ticket Tailor orders remain in the database as a frozen record.
export async function POST() {
  return NextResponse.json({ ok: true, ignored: 'tickettailor_retired' });
}
