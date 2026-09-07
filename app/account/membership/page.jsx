// app/account/membership/page.jsx
//
// Membership tab of the Stardust-account hub. Stub in this PR \u2014 exists so
// the third tab has a real destination. Members already have a full
// dashboard at /member; this tab will eventually surface the same
// membership status inline so a member doesn't have to bounce out of
// /account to see it.

import Link from 'next/link';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default function AccountMembershipPage() {
  return (
    <div
      style={{
        background: '#111',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 14,
        padding: 20,
      }}
    >
      <div style={{ fontSize: 15, color: '#f5f5f5', marginBottom: 6 }}>
        Membership lives on your member dashboard for now.
      </div>
      <div style={{ fontSize: 13, color: '#a0a0a0', marginBottom: 14 }}>
        We\u2019re moving it inline into your account soon.
      </div>
      <Link
        href="/member"
        className="inline-block"
        style={{
          padding: '10px 18px', borderRadius: 999,
          background: '#ffffff', color: '#0a0a0a',
          fontSize: 12, fontWeight: 700, letterSpacing: '0.14em',
          textDecoration: 'none',
        }}
      >
        OPEN MEMBER DASHBOARD
      </Link>
    </div>
  );
}
