import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/stub';
import { sweepUnlinkedTrialPasses } from '@/lib/trial-pass-account-sweep';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/cron/trial-pass-accounts
//
// Every-10-minutes Vercel cron. Gives each Trial SDG Pass that still has no
// account one — created quietly or linked to the existing account for its
// email. See lib/trial-pass-account-sweep.js. Sends no email.
export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });
  }
  try {
    const result = await sweepUnlinkedTrialPasses(createAdminClient());
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[cron.trial-pass-accounts]', err?.message || err);
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 });
  }
}
