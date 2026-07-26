import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSameOrigin } from '@/lib/manual-income';
import { ttFetch } from '@/lib/tickettailor';
import { BACKFILL_START_DATE } from '@/lib/tt-order-backfill';
import { runTtOrderBackfill } from '@/lib/tt-order-backfill-runner';

export const runtime = 'nodejs';

// The backfill walks TicketTailor a page at a time, so it is slower than a
// typical route. MAX_PAGES bounds the work to 5,000 orders, comfortably more
// than the Feb–Jul history and well inside the window.
export const maxDuration = 60;
const MAX_PAGES = 50;
const PAGE_SIZE = 100; // TicketTailor's maximum page size for list endpoints.

// OWNER-ONLY one-time historical backfill of public.ticket_order_attribution.
//
// WHY THIS ROUTE EXISTS: the table was created on 2026-07-25 for Mailchimp
// attribution and is only ever written by the live TicketTailor webhook, so it
// holds nothing older than its own creation date. That is why the sales chart
// on /bananas/analytics shows real dollars for late July 2026 and $0 for
// February through June. scripts/backfill-ticket-order-attribution.mjs does the
// same job from a shell, but requires a project owner to put production secrets
// into their environment by hand. Here the deployed app already has them.
//
// Security posture mirrors /api/admin/manual-income:
//   * requireOwner() — an authenticated admin whose auth.users email is the
//     canonical owner. Owner identity is server-controlled, never from the body.
//   * Same-origin check — defense in depth against CSRF on top of SameSite
//     session cookies.
//   * Secrets are read only from process.env server-side, exactly as the
//     webhook and the metrics-refresh job already do. No new credential
//     handling, and nothing reaches the client.
//   * dryRun defaults to TRUE, so an accidental bare POST cannot write.

// One page of GET /v1/orders, authenticated by lib/tickettailor.js's ttFetch
// (HTTP Basic with TICKETTAILOR_API_KEY).
function fetchOrderPage({ startingAfter }) {
  const qs = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (startingAfter) qs.set('starting_after', startingAfter);
  return ttFetch(`/orders?${qs.toString()}`);
}

export async function POST(request) {
  try {
    if (!isSameOrigin(request.headers.get('origin'), request.headers.get('host'))) {
      return NextResponse.json({ error: 'Cross-origin request rejected.' }, { status: 403 });
    }

    const { unauthorized } = await requireOwner();
    if (unauthorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!process.env.TICKETTAILOR_API_KEY) {
      return NextResponse.json(
        { error: 'TICKETTAILOR_API_KEY is not configured in this environment.' },
        { status: 400 },
      );
    }

    // Absent or unparseable body → dry run. Writing is strictly opt-in.
    let dryRun = true;
    try {
      const body = await request.json();
      if (body?.dryRun != null) {
        if (typeof body.dryRun !== 'boolean') {
          return NextResponse.json({ error: 'dryRun must be a boolean' }, { status: 400 });
        }
        dryRun = body.dryRun;
      }
    } catch {
      // Keep the safe default.
    }

    const result = await runTtOrderBackfill({
      fetchPage: fetchOrderPage,
      supabase: createAdminClient(),
      dryRun,
      startDate: BACKFILL_START_DATE,
      maxPages: MAX_PAGES,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('backfill-tt-orders error:', err);
    return NextResponse.json(
      { error: 'Server error: ' + (err?.message || 'unknown') },
      { status: 500 },
    );
  }
}
