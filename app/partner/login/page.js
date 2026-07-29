import Link from 'next/link';
import Wordmark from '@/app/components/Wordmark';
import PartnerSignIn from '../PartnerSignIn';

// Where a returning partner signs back in. Separate from the unified /login
// because that page is password-based and partners never get a password — the
// invite hands them an identity, not credentials.
//
// Every message here is deliberately non-committal about whether a given
// address is one of ours: this page is public, and our partner list is who we
// do business with.
const ERRORS = {
  no_invite:
    "That Google account isn't linked to a Stardust Garage partner invite. If you work with us, " +
    'check that you picked the same address we invited — or contact SDG and we\'ll send a new invite.',
  link_conflict:
    'That Google account is already the partner login for a different organization. Contact SDG so we can sort it out.',
  oauth_failed: 'Google sign-in didn\'t complete. Please try again, or use the email link.',
};

export default async function PartnerLoginPage({ searchParams }) {
  const sp = await searchParams;
  const message = ERRORS[sp?.error] || null;
  const email = typeof sp?.email === 'string' ? sp.email : null;

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-[400px]">
        <div className="flex justify-center mb-10">
          <Wordmark size="md" align="center" />
        </div>

        <div className="text-[11px] font-semibold tracking-[0.28em] mb-4 text-center" style={{ color: '#a0a0a0' }}>
          PARTNERS
        </div>
        <h1
          className="text-[28px] font-extrabold -tracking-[0.02em] mb-2 text-center leading-[1.1]"
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
        >
          Sign in.
        </h1>
        <p className="text-[13px] text-center mb-10" style={{ color: '#8a8a8a' }}>
          Promoters, collectives and vendors managing a guest list.
        </p>

        {message && (
          <div
            className="mb-8 px-5 py-4 rounded-[14px] text-[13px] leading-[1.6]"
            style={{ background: '#1a0a0a', border: '1px solid #8b1a1a', color: '#e2a0a0' }}
          >
            {message}
            {email && (
              <div className="mt-2 text-[12px]" style={{ color: '#a07070' }}>
                Signed in as {email}
              </div>
            )}
          </div>
        )}

        <PartnerSignIn />

        <div className="text-center mt-10">
          <Link
            href="/"
            className="text-[12px] underline hover:text-white transition-colors"
            style={{ color: '#a0a0a0' }}
          >
            Back to the site
          </Link>
        </div>
      </div>
    </main>
  );
}
