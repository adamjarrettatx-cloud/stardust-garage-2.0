import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import DeleteSignupButton from './DeleteSignupButton';

export const revalidate = 0;

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default async function SignupsPage() {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const supabase = await createClient();
  const { data: signups } = await supabase
    .from('signups')
    .select('*')
    .order('created_at', { ascending: false });

  const total = signups?.length || 0;
  const emailCount = signups?.filter((s) => s.contact_type === 'email').length || 0;
  const phoneCount = signups?.filter((s) => s.contact_type === 'phone').length || 0;

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
        href="/admin"
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

        {total > 0 && (
          <a
            href={csvHref}
            download={`signups-${new Date().toISOString().split('T')[0]}.csv`}
            className="px-6 py-2.5 rounded-full text-[12px] font-semibold tracking-[0.14em] border transition-colors hover:bg-white/5"
            style={{ borderColor: 'rgba(255,255,255,0.15)', color: '#f5f5f5' }}
          >
            DOWNLOAD CSV
          </a>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-10">
        <div className="rounded-[14px] p-6 border" style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.05)' }}>
          <div className="text-[11px] font-semibold tracking-[0.14em] mb-1.5" style={{ color: '#8a8a8a' }}>TOTAL</div>
          <div className="text-[32px] font-bold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{total}</div>
        </div>
        <div className="rounded-[14px] p-6 border" style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.05)' }}>
          <div className="text-[11px] font-semibold tracking-[0.14em] mb-1.5" style={{ color: '#8a8a8a' }}>EMAILS</div>
          <div className="text-[32px] font-bold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{emailCount}</div>
        </div>
        <div className="rounded-[14px] p-6 border" style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.05)' }}>
          <div className="text-[11px] font-semibold tracking-[0.14em] mb-1.5" style={{ color: '#8a8a8a' }}>PHONES</div>
          <div className="text-[32px] font-bold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{phoneCount}</div>
        </div>
      </div>

      {total === 0 ? (
        <div
          className="rounded-[14px] p-12 text-center border"
          style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.05)' }}
        >
          <p style={{ color: '#8a8a8a' }}>No signups yet. They&apos;ll appear here as people sign up.</p>
        </div>
      ) : (
        <div className="rounded-[14px] border overflow-hidden" style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.05)' }}>
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <th className="text-left px-6 py-4 text-[11px] font-semibold tracking-[0.14em]" style={{ color: '#8a8a8a' }}>CONTACT</th>
                <th className="text-left px-6 py-4 text-[11px] font-semibold tracking-[0.14em]" style={{ color: '#8a8a8a' }}>TYPE</th>
                <th className="text-left px-6 py-4 text-[11px] font-semibold tracking-[0.14em]" style={{ color: '#8a8a8a' }}>WHEN</th>
                <th className="text-right px-6 py-4 text-[11px] font-semibold tracking-[0.14em]" style={{ color: '#8a8a8a' }}></th>
              </tr>
            </thead>
            <tbody>
              {signups.map((s) => (
                <tr key={s.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <td className="px-6 py-4 text-[14px] font-medium">{s.contact}</td>
                  <td className="px-6 py-4 text-[13px]" style={{ color: '#8a8a8a' }}>{s.contact_type || '—'}</td>
                  <td className="px-6 py-4 text-[13px]" style={{ color: '#8a8a8a' }}>{formatDate(s.created_at)}</td>
                  <td className="px-6 py-4 text-right">
                    <DeleteSignupButton signupId={s.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
