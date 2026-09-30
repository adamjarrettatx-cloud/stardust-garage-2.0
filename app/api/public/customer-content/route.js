import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import content from '@/lib/customer-content.json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public display copy only. No account data, keys, payment decisions or grants.
// Both /members and mobile read this exact contract; edits no longer need an IPA.
export function GET() {
  const revision = createHash('sha256').update(JSON.stringify(content)).digest('hex');
  return NextResponse.json({ ...content, revision }, {
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}
