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

  const { orders } = await getWalletOrders({ supabaseAdmin, user });
  return NextResponse.json({ orders });
}
