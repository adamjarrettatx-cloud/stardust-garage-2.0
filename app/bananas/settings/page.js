import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ownerPageGate } from '@/lib/auth-helpers';
import SettingsForm from './SettingsForm';

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
    <main className="max-w-[800px] mx-auto px-6 py-16">
      <Link
        href="/bananas"
        className="inline-block text-[12px] font-semibold tracking-[0.14em] mb-8 transition-opacity hover:opacity-70"
        style={{ color: 'var(--text-3)' }}
      >
        ← BACK TO ADMIN
      </Link>

      <h1
        className="text-[40px] font-extrabold -tracking-[0.02em] leading-[1.1] mb-10"
        style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
      >
        Site Settings
      </h1>

      <SettingsForm initialSettings={settings} />
    </main>
  );
}
