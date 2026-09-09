'use client';

import Link from 'next/link';

// Small "Member ID" card at the top of /member/wallet.
//
// This is the entry point to /member/id/<token> \u2014 the full-screen badge the
// member holds up at the door. The card itself does NOT render the QR:
// showing the QR requires a big scannable size, and cramming that into the
// wallet fights with the rest of the page. Tapping the card opens the
// full-screen badge page instead, which is what staff actually scan.
//
// The destination mints a short-lived raw URL only after the signed-in member
// opens it; the database itself retains only a token hash.
export default function MemberIdCard({ isActive }) {
  const href = '/member/id';

  const accent = isActive ? '#d9c48c' : '#8a8a8a';
  const statusText = isActive ? 'ACTIVE MEMBER' : 'MEMBERSHIP INACTIVE';

  return (
    <section style={{ margin: '20px 0 32px' }}>
      <Link
        href={href}
        prefetch={false}
        style={{
          display: 'block',
          textDecoration: 'none',
          background: '#111',
          border: `1px solid ${accent}33`,
          borderRadius: 14,
          padding: '18px 20px',
          transition: 'transform 120ms ease, border-color 120ms ease',
          color: '#f5f5f5',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 10,
                letterSpacing: '0.18em',
                color: accent,
                fontWeight: 700,
                marginBottom: 6,
              }}
            >
              {statusText}
            </div>
            <div
              style={{
                fontSize: 18,
                fontWeight: 700,
                fontFamily: "'Plus Jakarta Sans', sans-serif",
                marginBottom: 4,
              }}
            >
              Member ID
            </div>
            <div style={{ fontSize: 13, color: '#8a8a8a', lineHeight: 1.5 }}>
              Tap to open your badge. Show the QR code at the door.
            </div>
          </div>
          <div
            aria-hidden="true"
            style={{
              flexShrink: 0,
              width: 40,
              height: 40,
              borderRadius: 10,
              background: accent + '1a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: accent,
              fontSize: 20,
              fontWeight: 700,
            }}
          >
            {'\u2192'}
          </div>
        </div>
      </Link>
    </section>
  );
}
