import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import StudioSettingsForm from './StudioSettingsForm';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';

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
    <main className="max-w-[700px] mx-auto px-6 py-16">
      <AuthenticatedPageHeader
        backHref="/bananas"
        backLabel="← BACK TO ADMIN"
        title="Studio Settings"
        titleClassName="text-[32px] font-extrabold -tracking-[0.02em] leading-[1.1]"
        className="mb-10"
      />

      <StudioSettingsForm settings={settings} />
    </main>
  );
}
