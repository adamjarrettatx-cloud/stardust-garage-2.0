import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireTeam } from '@/lib/auth-helpers';
import { isTicketScannerEnabled, isInternalTicketingEnabled } from '@/lib/feature-flags';

// GET /api/tickets/scanner-events
// Small helper for the /t/scan UI: returns upcoming + today's events the
// scanner can be pointed at. Team-gated (admins included).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isInternalTicketingEnabled() || !isTicketScannerEnabled()) {
    return NextResponse.json({ error: 'Scanner disabled' }, { status: 404 });
  }
  const gate = await requireTeam();
  if (gate.unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Show anything from yesterday onwards so late-night events past midnight
  // still appear. Filter to published + internal ticketing mode.
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 1);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const { data } = await supabaseAdmin
    .from('events')
    .select('id, title, slug, event_date, start_time, status, ticketing_mode')
    .in('ticketing_mode', ['internal'])
    .gte('event_date', cutoffStr)
    .order('event_date', { ascending: true })
    .limit(50);

  return NextResponse.json({ events: data || [] });
}
