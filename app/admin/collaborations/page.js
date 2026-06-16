import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import CollaborationsList from './CollaborationsList';

export const revalidate = 0;

export default async function CollaborationsPage() {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const supabase = await createClient();
  const { data: collabs } = await supabase
    .from('collaborations')
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
        Collaborations
      </h1>
      <p className="text-[14px] mb-10" style={{ color: '#8a8a8a' }}>
        Submissions from the Collaborate page (DJs and Artists).
      </p>

      <CollaborationsList collabs={collabs || []} />
    </main>
  );
}
