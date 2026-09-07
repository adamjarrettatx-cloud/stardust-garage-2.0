// app/account/tickets/page.jsx
//
// Server component. Renders every ticket order the signed-in user owns as a
// stack of cards. Layout in one place so the mobile experience (single
// column, scrollable) and the desktop experience (2-col grid) share the
// same data path.
//
// Data flow:
//   1. Auth is enforced by app/account/layout.js (redirects to /login).
//   2. This page re-resolves the user (server client) purely so it has an
//      auth.users id to pass to lib/wallet/get-orders.js.
//   3. get-orders returns the same shape as /api/wallet/orders \u2014 mobile app
//      + web parity, single source of truth.
//   4. Per-ticket QR SVGs are pre-rendered on the server so the client card
//      just embeds the string. That keeps @/lib/qr-code out of the browser
//      bundle (encoder is a few kb but unnecessary in the wallet render
//      path).
//   5. The client component <TicketsList> handles the interactive bits: QR
//      full-screen overlay, resend-email button, refund pill.

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/stub';
import { getWalletOrders, STARDUST_VENUE_ADDRESS } from '@/lib/wallet/get-orders';
import { renderTicketQrSvg } from '@/lib/tickets/qr';
import TicketsList from './TicketsList';
import CompleteProfileNudge from './CompleteProfileNudge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function AccountTicketsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Layout has already gated this, but re-check defensively so a missing
  // header/cookie edge case doesn't render an empty list under a stranger's
  // header.
  if (!user) {
    return (
      <div style={{ padding: '32px 0', color: '#8a8a8a' }}>Not signed in.</div>
    );
  }

  let orders = [];
  let freeAccount = null;
  if (isSupabaseConfigured()) {
    const admin = createAdminClient();
    const [walletRes, freeAccountRes] = await Promise.all([
      getWalletOrders({ supabaseAdmin: admin, user }),
      admin.from('free_accounts').select('user_id, phone, full_name, phone_verified_at').eq('user_id', user.id).maybeSingle(),
    ]);
    orders = walletRes.orders;
    freeAccount = freeAccountRes.data;
  }

  // Pre-render QR SVGs server-side so the client component doesn't need the
  // encoder library. Attach as _qrSvg alongside each ticket.
  const ordersWithQrs = orders.map((o) => ({
    ...o,
    tickets: (o.tickets || []).map((t) => ({
      ...t,
      _qrSvg: renderTicketQrSvg({ ticketCode: t.ticket_code, size: 320 }),
    })),
  }));

  // Google OAuth path: user is authenticated but has no free_accounts row
  // (or the phone is missing) \u2014 show a small nudge above the list so we
  // eventually capture the phone. See /api/free-account/complete-profile-no-verify.
  const needsProfileCompletion = !freeAccount || !freeAccount.phone;

  return (
    <div>
      {needsProfileCompletion && (
        <CompleteProfileNudge
          initialName={user.user_metadata?.full_name || freeAccount?.full_name || ''}
          initialPhone={freeAccount?.phone || ''}
        />
      )}
      <TicketsList orders={ordersWithQrs} venueAddress={STARDUST_VENUE_ADDRESS} />
    </div>
  );
}
