import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getWalletOrders } from '@/lib/wallet/get-orders';
import { renderTicketQrSvg } from '@/lib/tickets/qr';
import TicketEventGrid from './TicketEventGrid';
import { createProfilePhotoSignedUrl } from '@/lib/profile-photo';
import { validateLegalName } from '@/lib/legal-name';
import CompleteProfileNudge from '@/app/account/tickets/CompleteProfileNudge';
import WalletPhotoNudge from '@/components/profile-photo/WalletPhotoNudge';

export default async function ProfileTickets() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  try {
    // Every signed-in account retains its own customer wallet. Being staff
    // does not expose anyone else's purchases or grant a free ticket.
    const admin = createAdminClient();
    const [{ orders }, personalResult] = await Promise.all([
      getWalletOrders({ supabaseAdmin: admin, user, all: true }),
      admin.from('free_accounts').select('phone,full_name,profile_photo_path').eq('user_id', user.id).maybeSingle(),
    ]);
    if (personalResult.error) throw new Error('Profile could not be loaded.');
    const personal = personalResult.data;
    const needsCompletion = !personal?.phone || !validateLegalName(personal?.full_name || '').valid;
    const photo = await createProfilePhotoSignedUrl(admin, personal?.profile_photo_path);
    const withQrs = orders.map((order) => ({
      ...order,
      tickets: order.tickets.map((ticket) => ({
        ...ticket,
        _qrSvg: ticket.ticket_code ? renderTicketQrSvg({ ticketCode: ticket.ticket_code, size: 320 }) : null,
      })),
    }));
    return <>
      <TicketEventGrid orders={withQrs} initialNow={new Date().toISOString()} />
      {needsCompletion && <CompleteProfileNudge initialName={personal?.full_name || user.user_metadata?.full_name || ''} initialPhone={personal?.phone || ''} />}
      <WalletPhotoNudge hasPhoto={Boolean(personal?.profile_photo_path)} hasTickets={orders.length > 0}
        initialSignedUrl={photo?.signedUrl || null} nameOrEmail={personal?.full_name || user.email || ''} />
    </>;
  } catch {
    // A failed query is not an empty wallet. Never replace a purchase history
    // with a misleading "no tickets" message when the backend is unavailable.
    return <TicketEventGrid orders={[]} loadError initialNow={new Date().toISOString()} />;
  }
}
