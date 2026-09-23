import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { ownerPageGate } from '@/lib/auth-helpers';
import SettingsForm from './SettingsForm';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';

export const revalidate = 0;

export default async function SettingsPage() {
  const { user, redirect: gate } = await ownerPageGate();
  if (gate) redirect(gate);

  const supabase = await createClient();
  const { data } = await supabase.from('site_settings').select('*');

  const settings = {};
  (data || []).forEach((row) => {
    settings[row.key] = row.value || '';
  });

  return (
    <>
      <AuthenticatedPageHeader
        title="Site Settings"
        titleClassName="text-[30px] font-extrabold -tracking-[0.02em] leading-[1.15]"
        className="mb-10"
      />

      {process.env.VIEW_PORTAL_MODE === 'launcher'
        && user?.id === process.env.VIEW_PORTAL_OWNER_USER_ID && (
        <Link href="/bananas/view-portal" className="block mb-8 rounded-xl border p-5"
          style={{ borderColor: 'var(--auth-border)', background: 'var(--auth-card-bg)' }}>
          <span className="block font-bold" style={{ color: 'var(--auth-text)' }}>View Portal</span>
          <span className="block mt-2 text-sm" style={{ color: 'var(--auth-muted)' }}>
            Preview the website as a synthetic account in the isolated test environment.
          </span>
        </Link>
      )}
      <SettingsForm initialSettings={settings} />
    </>
  );
}
