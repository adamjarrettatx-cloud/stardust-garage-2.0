import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getRequestUser } from '@/lib/auth-helpers';
import { isInternalTicketingEnabled } from '@/lib/feature-flags';
import { getWalletOrders } from '@/lib/wallet/get-orders';

// GET /api/wallet/orders
// Returns the caller's ticket purchase history: paid orders + their tickets
// + basic event info. Ownership is scoped by user_id OR buyer_email so a
// member who bought before signing in still sees those tickets in-app.
//
// The join logic lives in lib/wallet/get-orders.js because the web ticket hub
// (app/account/tickets/page.jsx) needs the same shape but calls it directly
// as a server component rather than round-tripping through this endpoint.
// Keep the two in sync by editing the lib, never the query here.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  if (!isInternalTicketingEnabled()) return NextResponse.json({ error: 'Ticketing disabled' }, { status: 404 });
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Opt-in paging keeps existing app builds compatible while allowing the
  // new wallet to retrieve the complete history, not just 100 orders.
  const url = new URL(request.url);
  const paginated = url.searchParams.has('offset');
  const offset = Number(url.searchParams.get('offset') || 0);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) {
    return NextResponse.json({ error: 'Invalid wallet offset' }, { status: 400 });
  }
  try {
    const { orders } = await getWalletOrders({ supabaseAdmin, user, offset, complete: paginated });
    return NextResponse.json({
      orders,
      ...(paginated ? { next_offset: orders.length === 100 ? offset + 100 : null } : {}),
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ error: 'Tickets could not be loaded. Your purchases have not been removed.' }, { status: 503 });
  }
}
