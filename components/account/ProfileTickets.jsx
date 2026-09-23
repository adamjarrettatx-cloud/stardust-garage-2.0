import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getWalletOrders } from '@/lib/wallet/get-orders';
import { renderTicketQrSvg } from '@/lib/tickets/qr';
import TicketEventGrid from './TicketEventGrid';

export default async function ProfileTickets() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  try {
    // Every signed-in account retains its own customer wallet. Being staff
    // does not expose anyone else's purchases or grant a free ticket.
    const { orders } = await getWalletOrders({ supabaseAdmin: createAdminClient(), user, all: true });
    const withQrs = orders.map((order) => ({
      ...order,
      // Only the existing synthetic fixture gets clearly labeled demo art.
      // Real events always use their own flyer, or the missing-artwork state.
      event: order.event && process.env.VIEW_PORTAL_MODE === 'sandbox'
        && order.event.slug === 'view-preview-community-night' && !order.event.image_url
        ? { ...order.event, image_url: '/view-portal/community-night-preview.png' }
        : order.event,
      tickets: order.tickets.map((ticket) => ({
        ...ticket,
        _qrSvg: ticket.ticket_code ? renderTicketQrSvg({ ticketCode: ticket.ticket_code, size: 320 }) : null,
      })),
    }));
    return <TicketEventGrid orders={withQrs} initialNow={new Date().toISOString()} />;
  } catch {
    // A failed query is not an empty wallet. Never replace a purchase history
    // with a misleading "no tickets" message when the backend is unavailable.
    return <TicketEventGrid orders={[]} loadError initialNow={new Date().toISOString()} />;
  }
}
