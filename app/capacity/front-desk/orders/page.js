import { redirect } from 'next/navigation';
import { requireOrdersDesk } from '@/lib/auth-helpers';
import AuthenticatedThemeProvider from '@/app/components/AuthenticatedThemeProvider';
import StationSessionControls from '@/app/components/StationSessionControls';
import EventAttendeesClient from '@/app/bananas/events/[id]/attendees/EventAttendeesClient';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Orders & Refunds · Front Desk · Stardust Garage',
  robots: { index: false, follow: false },
};

// /capacity/front-desk/orders
//
// The same Orders & Refunds tool as /bananas/orders, outside the admin shell,
// for the shared Front Desk station (and admins). Staff can search orders,
// resend tickets to the order email, and review/confirm Stripe refunds.
// The station allowlist (lib/station-policy.js) and requireOrdersDesk() on
// every API keep voids, order detail and all other admin pages off limits.
export default async function FrontDeskOrdersPage() {
  const { unauthorized, deskStation } = await requireOrdersDesk();
  if (unauthorized) redirect('/staff/login');
  return (
    <AuthenticatedThemeProvider scope="team">
      {deskStation && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', maxWidth: 1400, margin: '0 auto', padding: '16px 16px 0' }}>
          <StationSessionControls />
        </div>
      )}
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '24px 16px' }}>
        <EventAttendeesClient deskMode />
      </div>
    </AuthenticatedThemeProvider>
  );
}
