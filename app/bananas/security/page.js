import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser, getMfaStatus, adminMfaEnforced } from '@/lib/auth-helpers';
import MfaEnrollClient from './MfaEnrollClient';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

export default async function SecurityPage({ searchParams }) {
  // Defense-in-depth: middleware gates /admin/*, but verify here too.
  const { user, isAdmin } = await getCurrentUser();
  if (!user) redirect('/bananas/login');
  if (!isAdmin) redirect('/member');

  const sp = await searchParams;
  const mfaRequired = sp?.mfa === 'required';

  const status = await getMfaStatus();
  const enforced = adminMfaEnforced();

  return (
    <main className="max-w-[800px] mx-auto px-6 py-16">
      <Link
        href="/bananas"
        className="inline-block text-[12px] font-semibold tracking-[0.14em] mb-8 transition-opacity hover:opacity-70"
        style={{ color: 'var(--text-3)' }}
      >
        ← BACK TO ADMIN
      </Link>

      <div className="flex items-baseline justify-between gap-4 mb-2">
        <h1
          className="text-[40px] font-extrabold -tracking-[0.02em] leading-[1.1]"
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
        >
          Security
        </h1>
        <div className="text-[11px] tracking-[0.18em]" style={{ color: 'var(--text-3)' }}>
          {enforced ? 'MFA REQUIRED' : 'MFA OPTIONAL'}
        </div>
      </div>
      <p className="mb-8 text-[14px]" style={{ color: 'var(--text-3)' }}>
        Manage two-factor authentication for your account. Current assurance level:{' '}
        <strong>{status.currentLevel || 'aal1'}</strong>.
      </p>

      {mfaRequired && (
        <div
          className="mb-6 p-4 rounded-[12px] text-[13px]"
          style={{ background: 'rgba(255,184,77,0.1)', border: '1px solid rgba(255,184,77,0.3)', color: 'var(--st-ffd599)' }}
        >
          <strong>Two-factor authentication is required.</strong>{' '}
          {status.hasVerifiedFactor
            ? 'Sign out and sign back in to complete the second-factor challenge, then retry.'
            : 'Enroll an authenticator below to regain access to admin tools.'}
        </div>
      )}

      <MfaEnrollClient />
    </main>
  );
}
