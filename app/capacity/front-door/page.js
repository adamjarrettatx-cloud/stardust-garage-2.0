import { redirect } from 'next/navigation';
import { requireTeam } from '@/lib/auth-helpers';
import FrontDoorClient from './FrontDoorClient';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Front Door · Capacity',
  other: { 'theme-color': '#0a0a0a' },
};

// Lock the door station to a chrome-free kiosk viewport: no user zoom and
// viewport-fit=cover so the safe-area insets in CounterShell take effect.
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#0a0a0a',
};

// Two ways to reach this page:
//   1. A provisioned Jelly2 with a device token in the URL (?token=...). The
//      token is verified server-side by /api/capacity/device/* — we do NOT
//      require a team session in that case (middleware already let it through).
//   2. A logged-in team member browsing in (no token) — gated as before.
// We never read/verify the token here; we just pick which API mode the client
// uses. The raw token stays in the URL/memory and is sent to the device API.
export default async function FrontDoorPage({ searchParams }) {
  const sp = await searchParams;
  const token = typeof sp?.token === 'string' ? sp.token : null;

  if (!token) {
    const { unauthorized } = await requireTeam();
    if (unauthorized) redirect('/team/login');
  }

  return <FrontDoorClient token={token} />;
}
