// Public delete-account instructions page. Required by Google Play (Data
// safety form) and Apple App Store (Guideline 5.1.1(v)): users must be
// able to find out how to delete their account and associated data
// WITHOUT installing the app.
//
// This page is the URL we submit in Play Console → Data safety → "Delete
// account URL" and reference in the App Store listing.

import Link from 'next/link';

export const metadata = {
  title: 'Delete Account · Stardust Garage',
  description:
    'How to permanently delete your Stardust Garage account, what data is removed, what data we must keep, and how to contact us for help.',
};

export default function DeleteAccountPage() {
  return (
    <main
      style={{
        maxWidth: 760,
        margin: '0 auto',
        padding: '3rem 1.25rem 5rem',
        color: '#f5f5f5',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        lineHeight: 1.65,
        fontSize: '1.02rem',
      }}
    >
      <p style={{ marginBottom: '0.5rem' }}>
        <Link
          href="/"
          style={{
            color: '#d9c48c',
            textDecoration: 'none',
            fontSize: '0.9rem',
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
          }}
        >
          ← Stardust Garage
        </Link>
      </p>

      <h1
        style={{
          fontSize: '2.25rem',
          margin: '1.5rem 0 0.5rem',
          fontWeight: 500,
          letterSpacing: '-0.01em',
        }}
      >
        Delete your account
      </h1>
      <p style={{ color: '#9a9a9a', margin: 0, fontSize: '0.95rem' }}>
        Stardust Garage · SDG Mobile
      </p>

      <hr
        style={{
          border: 0,
          borderTop: '1px solid #2a2a2a',
          margin: '2rem 0',
        }}
      />

      <p>
        You can permanently delete your Stardust Garage account and the
        personal data associated with it at any time. Deletion applies to
        both the SDG Mobile app and{' '}
        <Link href="/" style={{ color: '#d9c48c' }}>
          sdgatx.com
        </Link>
        , since they share the same account.
      </p>

      <h2 style={{ fontSize: '1.4rem', marginTop: '2.5rem', fontWeight: 500 }}>
        Option 1 — Delete from the SDG Mobile app
      </h2>
      <ol style={{ paddingLeft: '1.25rem' }}>
        <li>Open <strong>SDG Mobile</strong> and sign in.</li>
        <li>Tap the <strong>Profile</strong> tab (bottom right).</li>
        <li>Scroll to the bottom and tap <strong>Delete Account</strong>.</li>
        <li>Read the confirmation, then tap <strong>Delete Account</strong> to confirm.</li>
      </ol>
      <p>
        Your account is removed immediately. You will be signed out and the
        app will return to the sign-in screen.
      </p>

      <h2 style={{ fontSize: '1.4rem', marginTop: '2.5rem', fontWeight: 500 }}>
        Option 2 — Delete from the website
      </h2>
      <ol style={{ paddingLeft: '1.25rem' }}>
        <li>
          Sign in at{' '}
          <Link href="/login" style={{ color: '#d9c48c' }}>
            sdgatx.com/login
          </Link>
          .
        </li>
        <li>
          Go to{' '}
          <Link href="/account/profile" style={{ color: '#d9c48c' }}>
            Account → Profile
          </Link>
          .
        </li>
        <li>
          Scroll to the bottom and click <strong>Delete Account</strong>.
        </li>
        <li>Confirm on the prompt.</li>
      </ol>

      <h2 style={{ fontSize: '1.4rem', marginTop: '2.5rem', fontWeight: 500 }}>
        Option 3 — Email us
      </h2>
      <p>
        If you cannot sign in, email{' '}
        <a
          href="mailto:hello@sdgatx.com?subject=Delete%20my%20account"
          style={{ color: '#d9c48c' }}
        >
          hello@sdgatx.com
        </a>{' '}
        from the email address on your account and ask us to delete it. We
        respond within 5 business days and complete deletion within 30 days
        of a verified request.
      </p>

      <hr
        style={{
          border: 0,
          borderTop: '1px solid #2a2a2a',
          margin: '2.5rem 0',
        }}
      />

      <h2 style={{ fontSize: '1.4rem', fontWeight: 500 }}>
        What gets deleted
      </h2>
      <ul style={{ paddingLeft: '1.25rem' }}>
        <li>Your name, display name, profile photo, and phone number</li>
        <li>Your email address and authentication credentials</li>
        <li>Your membership record and membership tier history</li>
        <li>Your push notification tokens</li>
        <li>Your saved event bookmarks and preferences</li>
        <li>Your account&#39;s personal metadata in Supabase</li>
      </ul>

      <h2 style={{ fontSize: '1.4rem', marginTop: '2rem', fontWeight: 500 }}>
        What we keep, and why
      </h2>
      <p>
        Some records are kept in a de-identified or legally-required form
        even after account deletion:
      </p>
      <ul style={{ paddingLeft: '1.25rem' }}>
        <li>
          <strong>Ticket, purchase, and payment records</strong> — retained
          for tax, accounting, chargeback, and audit purposes, per Texas
          record-retention requirements.
        </li>
        <li>
          <strong>Liability waiver acceptances</strong> — retained as
          venue-safety records tied to the event you attended. These are
          hashed and stored under the venue&#39;s legal records, not tied
          to your active account.
        </li>
        <li>
          <strong>Anonymized analytics</strong> — event attendance counts,
          venue capacity metrics, and other aggregate data that cannot be
          tied back to you.
        </li>
        <li>
          <strong>Records required by law</strong> — including
          TABC/alcohol compliance records where applicable.
        </li>
      </ul>
      <p>
        These retained records are separated from your personal profile
        and are used only for the purposes above. See our{' '}
        <Link href="/privacy" style={{ color: '#d9c48c' }}>
          Privacy Policy
        </Link>{' '}
        for full details on retention periods.
      </p>

      <h2 style={{ fontSize: '1.4rem', marginTop: '2rem', fontWeight: 500 }}>
        Timing
      </h2>
      <p>
        In-app and website deletions are processed immediately. Emailed
        requests are completed within 30 days of verification. Backups
        containing your data are overwritten on our standard rotation
        within 90 days.
      </p>

      <h2 style={{ fontSize: '1.4rem', marginTop: '2rem', fontWeight: 500 }}>
        Questions
      </h2>
      <p>
        Email{' '}
        <a href="mailto:hello@sdgatx.com" style={{ color: '#d9c48c' }}>
          hello@sdgatx.com
        </a>
        .
      </p>

      <hr
        style={{
          border: 0,
          borderTop: '1px solid #2a2a2a',
          margin: '2.5rem 0 1.5rem',
        }}
      />
      <p style={{ color: '#7a7a7a', fontSize: '0.85rem', margin: 0 }}>
        Stardust Garage is operated by Simple Boring Office, LLC (Austin,
        Texas). This page is the public deletion instructions required by
        Google Play and the Apple App Store.
      </p>
    </main>
  );
}
