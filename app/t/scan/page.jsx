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
    <main
      style={{
        minHeight: '100vh',
        background: '#0a0a0a',
        color: '#f5f5f5',
        fontFamily: "'Plus Jakarta Sans', sans-serif",
      }}
    >
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '32px 20px 60px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 24,
          }}
        >
          <h1
            style={{
              fontSize: 22,
              fontWeight: 800,
              letterSpacing: '-0.01em',
              margin: 0,
            }}
          >
            Door Scanner
          </h1>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.16em',
              color: '#8a8a8a',
              textTransform: 'uppercase',
            }}
          >
            STARDUST GARAGE
          </span>
        </div>
        <ScannerClient prefillCode={prefill} />
      </div>
    </main>
  );
}
