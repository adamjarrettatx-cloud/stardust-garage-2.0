import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import ApplicationsList from './ApplicationsList';

export const revalidate = 0;

export default async function ApplicationsPage() {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const supabase = await createClient();
  const { data: applications } = await supabase
    .from('membership_applications')
    .select('*')
    .order('created_at', { ascending: false });

  return (
    <main className="max-w-[1200px] mx-auto px-6 py-16">
      <Link
        href="/admin"
        className="inline-block text-[12px] font-semibold tracking-[0.14em] mb-8 transition-opacity hover:opacity-70"
        style={{ color: '#8a8a8a' }}
      >
        ← BACK TO ADMIN
      </Link>

      <h1
        className="text-[40px] font-extrabold -tracking-[0.02em] leading-[1.1] mb-2"
        style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
      >
        Membership Applications
      </h1>
      <p className="text-[14px] mb-10" style={{ color: '#8a8a8a' }}>
        Applications submitted through the Members page.
      </p>

      <ApplicationsList applications={applications || []} />
    </main>
  );
}
