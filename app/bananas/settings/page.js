import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ownerPageGate } from '@/lib/auth-helpers';
import SettingsForm from './SettingsForm';
import {
  AuthenticatedPageHeader,
  AuthenticatedPageSurface,
} from '@/app/components/AuthenticatedPageTheme';

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
    <AuthenticatedPageSurface
      scope="admin"
      width="max-w-[800px]"
      className="transition-colors duration-150"
      testId="route-bananas-settings"
    >
      <AuthenticatedPageHeader
        scope="admin"
        backHref="/bananas"
        title="Site Settings"
        titleClassName="text-[40px]"
      />
      <SettingsForm initialSettings={settings} />
    </AuthenticatedPageSurface>
  );
}
