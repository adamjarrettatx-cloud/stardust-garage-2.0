import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sweepExpiredHolds } from '@/lib/tickets/fulfillment';

// POST /api/cron/sweep-ticket-holds
// Releases inventory reserved by holds whose 15-minute TTL has passed.
// Runs every 5 min from vercel.json. Auth via Bearer CRON_SECRET, matching
// the existing cron routes.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function run(request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  try {
    const result = await sweepExpiredHolds(supabaseAdmin, { limit: 500 });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('sweep-ticket-holds failed:', err);
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
