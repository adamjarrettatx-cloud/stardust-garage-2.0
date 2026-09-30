import { redirect } from 'next/navigation';
import { getCurrentUser, getMfaStatus, adminMfaEnforced } from '@/lib/auth-helpers';
import MfaEnrollClient from './MfaEnrollClient';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';
import { adminMfaReturnTo } from '@/lib/admin-mfa-step-up';

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
  const returnTo = adminMfaReturnTo(sp?.next);
  const challengeRequired = mfaRequired && !status.mfaSatisfied;

  return (
    <>
      <AuthenticatedPageHeader
        title="Security"
        description={`Manage two-factor authentication for your account. Current assurance level: ${status.currentLevel || 'aal1'}.`}
        eyebrow={challengeRequired || enforced ? 'MFA REQUIRED' : 'ACCOUNT SECURITY'}
        titleClassName="text-[30px] font-extrabold -tracking-[0.02em] leading-[1.15]"
        className="mb-8"
      />

      {challengeRequired && (
        <div
          className="mb-6 p-4 rounded-[12px] text-[13px]"
          style={{ background: 'rgba(255,184,77,0.1)', border: '1px solid rgba(255,184,77,0.3)', color: '#ffd599' }}
        >
          <strong>Two-factor authentication is required.</strong>{' '}
          {status.hasVerifiedFactor
            ? 'Enter a code from your existing authenticator below to continue. You do not need to sign out or add another authenticator.'
            : 'Enroll an authenticator below to regain access to admin tools.'}
        </div>
      )}

      <MfaEnrollClient required={mfaRequired} enforced={enforced} returnTo={returnTo} currentLevel={status.currentLevel} />
    </>
  );
}
