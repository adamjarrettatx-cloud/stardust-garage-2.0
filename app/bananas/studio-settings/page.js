import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ownerPageGate } from '@/lib/auth-helpers';
import StudioSettingsForm from './StudioSettingsForm';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';

export const revalidate = 0;

// Owner-only for now. Studio Settings is on the back burner (owner decision
// 2026-08-29) and its tile lives under the owner-only Settings tab, so the page
// gate matches: a non-owner admin with the direct URL is sent back to /bananas.
// Widening this to team-role viewing later is a deliberate, separate change.
export default async function StudioSettingsPage() {
  const { redirect: gate } = await ownerPageGate();
  if (gate) redirect(gate);

  const supabase = await createClient();
  const { data: settings } = await supabase
    .from('studio_settings')
    .select('*')
    .eq('id', 1)
    .single();

  return (
    <>
      <AuthenticatedPageHeader
        title="Studio Settings"
        titleClassName="text-[30px] font-extrabold -tracking-[0.02em] leading-[1.15]"
        className="mb-10"
      />

      <StudioSettingsForm settings={settings} />
    </>
  );
}
