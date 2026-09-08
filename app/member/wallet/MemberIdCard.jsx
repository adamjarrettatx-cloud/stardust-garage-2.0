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
// Three visual states:
//   * hasToken + active   \u2014 gold "OPEN MEMBER ID" call to action
//   * hasToken + inactive \u2014 muted card, "Membership inactive" hint but the
//     link still works (staff may still want to verify identity)
//   * no token            \u2014 card links to /member/id which mints one on the
//     fly. Copy explains why so a member seeing this once (backfill gap)
//     understands what happened.
export default function MemberIdCard({ tokenRaw, isActive }) {
  const hasToken = Boolean(tokenRaw);
  const href = hasToken ? `/member/id/${tokenRaw}` : '/member/id';

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
              {hasToken
                ? 'Tap to open your badge. Show the QR code at the door.'
                : 'Tap to generate your badge. You only see this the first time.'}
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
