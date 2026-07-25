import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import StudioSettingsForm from './StudioSettingsForm';
import {
  AuthenticatedPageHeader,
  AuthenticatedPageSurface,
} from '@/app/components/AuthenticatedPageTheme';

export const revalidate = 0;

export default async function StudioSettingsPage() {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const supabase = await createClient();
  const { data: settings } = await supabase
    .from('studio_settings')
    .select('*')
    .eq('id', 1)
    .single();

  return (
    <AuthenticatedPageSurface
      scope="admin"
      width="max-w-[700px]"
      className="transition-colors duration-150"
      testId="route-bananas-studio-settings"
    >
      <AuthenticatedPageHeader
        scope="admin"
        backHref="/bananas"
        title="Studio Settings"
      />
      <StudioSettingsForm settings={settings} />
    </AuthenticatedPageSurface>
  );
}
