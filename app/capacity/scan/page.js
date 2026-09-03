import { redirect } from 'next/navigation';
import { requireTeam } from '@/lib/auth-helpers';
import ScanClient from './ScanClient';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Scan · Stardust Garage',
  robots: { index: false, follow: false },
  other: { 'theme-color': '#0a0a0a' },
};

// /capacity/scan
//
// The iPad door page. A guest holds up their Trial SDG Pass QR (or their phone
// showing the /pass/<token> URL), the iPad camera reads it, the page POSTs the
// token to /api/capacity/trial-pass/scan, and the result — big green ALLOWED
// or big red DENIED with the reason — fills the screen.
//
// On every ALLOWED scan the page also bumps the live capacity via the same
// /api/capacity/operation endpoint the laptop and Jelly2 kiosks use, so the
// running count on every other capacity page reflects the guest walking in
// without staff having to tap anything extra.
//
// Auth mirrors the rest of /capacity/*: middleware gates the route to the team
// role, and this server component calls requireTeam() to fail closed if that
// check ever gets bypassed. There is no device-token path here on purpose —
// the iPad is a supervised device on the front desk, not an unattended Jelly2.
//
// The scanning UI is a client component because it needs the camera and the
// BarcodeDetector API. Everything else — auth, redirect, no-chrome layout —
// stays on the server so the page renders instantly even on a cold-cache load
// at the door.
export default async function CapacityScanPage() {
  const { unauthorized } = await requireTeam();
  if (unauthorized) redirect('/team/login');

  return <ScanClient />;
}
