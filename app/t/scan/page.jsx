import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth-helpers';
import { isTicketScannerEnabled, isInternalTicketingEnabled } from '@/lib/feature-flags';
import { normalizeTicketCode } from '@/lib/tickets/codes';
import ScannerClient from './ScannerClient';

// /t/scan?t=<code> — dual-purpose landing.
//   * Team/admin user  -> Scanner UI. Optionally pre-fills the code from ?t=
//     if the URL came from an actual scan (QR payload is /t/scan?t=<code>).
//   * Regular user     -> Redirect to /t/<code> so they just see their ticket.
export const dynamic = 'force-dynamic';

export default async function ScanPage({ searchParams }) {
  if (!isInternalTicketingEnabled()) redirect('/');
  const params = await searchParams;
  const prefill = normalizeTicketCode(params?.t) || '';

  const { user, isAdmin, teamRole } = await getCurrentUser();
  const isTeam = Boolean(isAdmin || teamRole);

  if (!isTeam || !isTicketScannerEnabled()) {
    // Non-team scanning a QR just wants to view the ticket. Route them.
    if (prefill) redirect(`/t/${encodeURIComponent(prefill)}`);
    if (!user) redirect('/login?next=/t/scan');
    redirect('/member/wallet');
  }

  return (
    <main style={{ maxWidth: 520, margin: '32px auto', padding: 20 }}>
      <h1>Door Scanner</h1>
      <ScannerClient prefillCode={prefill} />
    </main>
  );
}
