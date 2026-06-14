import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser, getMfaStatus, adminMfaEnforced } from '@/lib/auth-helpers';
import MfaEnrollClient from './MfaEnrollClient';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

export default async function SecurityPage() {
  // Defense-in-depth: middleware gates /admin/*, but verify here too.
  const { user, isAdmin } = await getCurrentUser();
  if (!user) redirect('/admin/login');
  if (!isAdmin) redirect('/member');

  const status = await getMfaStatus();
  const enforced = adminMfaEnforced();

  return (
    <main className="max-w-[800px] mx-auto px-6 py-16">
      <Link
        href="/admin"
        className="inline-block text-[12px] font-semibold tracking-[0.14em] mb-8 transition-opacity hover:opacity-70"
        style={{ color: '#8a8a8a' }}
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
        <div className="text-[11px] tracking-[0.18em]" style={{ color: '#8a8a8a' }}>
          {enforced ? 'MFA REQUIRED' : 'MFA OPTIONAL'}
        </div>
      </div>
      <p className="mb-8 text-[14px]" style={{ color: '#8a8a8a' }}>
        Manage two-factor authentication for your account. Current assurance level:{' '}
        <strong>{status.currentLevel || 'aal1'}</strong>.
      </p>

      <MfaEnrollClient />
    </main>
  );
}
