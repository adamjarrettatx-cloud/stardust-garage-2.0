import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import SignupsClient from './SignupsClient';

export const revalidate = 0;

export default async function SignupsPage() {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const supabase = await createClient();
  const { data: signups } = await supabase
    .from('signups')
    .select('*')
    .order('created_at', { ascending: false });

  const total = signups?.length || 0;

  const downloadCsv = () => {
    if (!signups || signups.length === 0) return '';
    const header = 'Contact,Type,Source,Signed Up At\n';
    const rows = signups
      .map((s) => `"${s.contact}","${s.contact_type || ''}","${s.source || ''}","${s.created_at}"`)
      .join('\n');
    return header + rows;
  };

  const csvContent = downloadCsv();
  const csvHref = `data:text/csv;charset=utf-8,${encodeURIComponent(csvContent)}`;

  return (
    <main className="max-w-[1100px] mx-auto px-6 py-16">
      <Link
        href="/bananas"
        className="inline-block text-[12px] font-semibold tracking-[0.14em] mb-8 transition-opacity hover:opacity-70"
        style={{ color: '#8a8a8a' }}
      >
        ← BACK TO ADMIN
      </Link>

      <div className="flex items-start justify-between mb-10">
        <div>
          <h1
            className="text-[40px] font-extrabold -tracking-[0.02em] leading-[1.1] mb-2"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            Signups
          </h1>
          <p className="text-[14px]" style={{ color: '#8a8a8a' }}>
            People who signed up via &quot;Stay in the loop&quot; on the homepage.
          </p>
        </div>
      </div>
      <SignupsClient signups={signups || []} csvHref={csvHref} />
    </main>
  );
}
