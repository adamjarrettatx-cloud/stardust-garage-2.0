import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';

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

function formatEventDate(dateString) {
  if (!dateString) return '';
  return new Date(dateString + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default async function MicroPartyInquiriesPage() {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const supabase = await createClient();
  const { data: inquiries } = await supabase
    .from('micro_party_inquiries')
    .select('*')
    .order('created_at', { ascending: false });

  const total = inquiries?.length || 0;
  const newCount = inquiries?.filter((i) => i.status === 'new').length || 0;
  const approved = inquiries?.filter((i) => i.status === 'approved').length || 0;

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
        Micro Party Inquiries
      </h1>
      <p className="text-[14px] mb-10" style={{ color: '#8a8a8a' }}>
        Inquiries submitted through the Micro Parties / Birthdays form.
      </p>

      <div className="grid grid-cols-3 gap-4 mb-10">
        <div className="rounded-[14px] p-6 border" style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.05)' }}>
          <div className="text-[11px] font-semibold tracking-[0.14em] mb-1.5" style={{ color: '#8a8a8a' }}>TOTAL</div>
          <div className="text-[32px] font-bold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{total}</div>
        </div>
        <div className="rounded-[14px] p-6 border" style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.05)' }}>
          <div className="text-[11px] font-semibold tracking-[0.14em] mb-1.5" style={{ color: '#8a8a8a' }}>NEW</div>
          <div className="text-[32px] font-bold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{newCount}</div>
        </div>
        <div className="rounded-[14px] p-6 border" style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.05)' }}>
          <div className="text-[11px] font-semibold tracking-[0.14em] mb-1.5" style={{ color: '#8a8a8a' }}>APPROVED</div>
          <div className="text-[32px] font-bold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{approved}</div>
        </div>
      </div>

      {total === 0 ? (
        <div
          className="rounded-[14px] p-12 text-center border"
          style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.05)' }}
        >
          <p style={{ color: '#8a8a8a' }}>No micro party inquiries yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {inquiries.map((i) => (
            <Link
              key={i.id}
              href={`/admin/micro-parties/${i.id}`}
              className="block rounded-[14px] p-6 border transition-colors hover:border-white/20"
              style={{
                background: i.status === 'new' ? '#1a1814' : '#141414',
                borderColor: i.status === 'new' ? 'rgba(255,184,77,0.2)' : 'rgba(255,255,255,0.05)',
              }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1 flex-wrap">
                    <h3 className="text-[18px] font-bold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                      {i.event_name || i.full_name}
                    </h3>
                    {i.event_type && (
                      <span className="text-[13px]" style={{ color: '#8a8a8a' }}>
                        {i.event_type}
                      </span>
                    )}
                  </div>
                  <div className="text-[13px] flex flex-wrap gap-x-4 gap-y-1" style={{ color: '#8a8a8a' }}>
                    <span>{i.full_name}</span>
                    <span>{i.email}</span>
                    {i.event_date && <span>{formatEventDate(i.event_date)}</span>}
                    {i.expected_attendance && <span>{i.expected_attendance} ppl</span>}
                  </div>
                </div>
                <div className="flex-shrink-0 text-right">
                  {i.status === 'new' && (
                    <span
                      className="text-[10px] font-bold tracking-[0.14em] px-2.5 py-1 rounded-full"
                      style={{ background: '#ffb84d', color: '#0a0a0a' }}
                    >
                      NEW
                    </span>
                  )}
                  <div
                    className="inline-block text-[10px] font-semibold tracking-[0.14em] px-3 py-1 rounded-full uppercase"
                    style={{
                      background:
                        i.status === 'approved' ? 'rgba(34,197,94,0.15)' :
                        i.status === 'rejected' ? 'rgba(239,68,68,0.15)' :
                        i.status === 'reviewed' ? 'rgba(168,85,247,0.12)' :
                        i.status === 'pending' ? 'rgba(255,255,255,0.06)' :
                        'rgba(255,184,77,0.15)',
                      color:
                        i.status === 'approved' ? '#4ade80' :
                        i.status === 'rejected' ? '#f87171' :
                        i.status === 'reviewed' ? '#c084fc' :
                        i.status === 'pending' ? '#a0a0a0' :
                        '#ffb84d',
                    }}
                  >
                    {i.status || 'new'}
                  </div>
                  <div className="text-[11px] mt-2" style={{ color: '#666' }}>
                    {formatDate(i.created_at)}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
