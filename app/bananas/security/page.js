import { redirect } from 'next/navigation';
import { getCurrentUser, getMfaStatus, adminMfaEnforced } from '@/lib/auth-helpers';
import MfaEnrollClient from './MfaEnrollClient';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';

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
    <>
      <AuthenticatedPageHeader
        title="Security"
        description={`Manage two-factor authentication for your account. Current assurance level: ${status.currentLevel || 'aal1'}.`}
        eyebrow={enforced ? 'MFA REQUIRED' : 'MFA OPTIONAL'}
        titleClassName="text-[30px] font-extrabold -tracking-[0.02em] leading-[1.15]"
        className="mb-8"
      />

      {mfaRequired && (
        <div
          className="mb-6 p-4 rounded-[12px] text-[13px]"
          style={{ background: 'rgba(255,184,77,0.1)', border: '1px solid rgba(255,184,77,0.3)', color: '#ffd599' }}
        >
          <strong>Two-factor authentication is required.</strong>{' '}
          {status.hasVerifiedFactor
            ? 'Sign out and sign back in to complete the second-factor challenge, then retry.'
            : 'Enroll an authenticator below to regain access to admin tools.'}
        </div>
      )}

      <MfaEnrollClient />
    </>
  );
}
