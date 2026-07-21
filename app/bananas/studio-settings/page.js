import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import StudioSettingsForm from './StudioSettingsForm';

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
      <Link
        href="/bananas"
        className="text-[12px] tracking-[0.14em] mb-4 inline-block hover:text-white transition-colors"
        style={{ color: '#8a8a8a' }}
      >
        ← BACK TO ADMIN
      </Link>
      <h1
        className="text-[32px] font-extrabold -tracking-[0.02em] leading-[1.1] mb-10"
        style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
      >
        Studio Settings
      </h1>

      <StudioSettingsForm settings={settings} />
    </main>
  );
}
