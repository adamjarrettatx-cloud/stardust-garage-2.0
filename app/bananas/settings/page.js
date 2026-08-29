import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ownerPageGate } from '@/lib/auth-helpers';
import SettingsForm from './SettingsForm';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';

export const revalidate = 0;

export default async function SettingsPage() {
  const { redirect: gate } = await ownerPageGate();
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

      <SettingsForm initialSettings={settings} />
    </>
  );
}
