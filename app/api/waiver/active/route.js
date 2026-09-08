import { NextResponse } from 'next/server';
import { publicWaiverPayload } from '@/lib/waiver/versions';

// GET /api/waiver/active
// Returns { slug, version, kind, checkboxLabel, bodyMarkdown, bodySha256 }
// for the current active ticket waiver. Cached briefly at the edge.

export const runtime = 'nodejs';

export async function GET() {
  const payload = publicWaiverPayload('ticket');
  return NextResponse.json(payload, {
    headers: {
      'cache-control': 'public, s-maxage=60, stale-while-revalidate=300',
    },
  });
}
