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

const TYPE_LABELS = {
  'micro-parties': 'MICRO PARTIES',
  'host-your-own': 'HOST-YOUR-OWN',
  'entire-space': 'ENTIRE SPACE',
};

export default async function VenueInquiriesPage() {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const supabase = await createClient();
  const { data: inquiries } = await supabase
    .from('venue_inquiries')
    .select('*')
    .order('created_at', { ascending: false });

  const total = inquiries?.length || 0;
  const pending = inquiries?.filter((i) => i.status === 'pending').length || 0;
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
        Venue Inquiries
      </h1>
      <p className="text-[14px] mb-10" style={{ color: '#8a8a8a' }}>
        Inquiries submitted through the Venue Rental page.
      </p>

      <div className="grid grid-cols-3 gap-4 mb-10">
        <div className="rounded-[14px] p-6 border" style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.05)' }}>
          <div className="text-[11px] font-semibold tracking-[0.14em] mb-1.5" style={{ color: '#8a8a8a' }}>TOTAL</div>
          <div className="text-[32px] font-bold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{total}</div>
        </div>
        <div className="rounded-[14px] p-6 border" style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.05)' }}>
          <div className="text-[11px] font-semibold tracking-[0.14em] mb-1.5" style={{ color: '#8a8a8a' }}>PENDING</div>
          <div className="text-[32px] font-bold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{pending}</div>
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
          <p style={{ color: '#8a8a8a' }}>No venue inquiries yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {inquiries.map((i) => (
            <Link
              key={i.id}
              href={`/admin/venue-inquiries/${i.id}`}
              className="block rounded-[14px] p-6 border transition-colors hover:border-white/20"
              style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.05)' }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="text-[18px] font-bold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                      {i.event_name}
                    </h3>
                    <span className="text-[13px]" style={{ color: '#8a8a8a' }}>
                      {i.event_type}
                    </span>
                  </div>
                  <div className="text-[13px] flex flex-wrap gap-x-4 gap-y-1" style={{ color: '#8a8a8a' }}>
                    <span>{i.full_name}</span>
                    <span>{i.email}</span>
                    <span>{i.preferred_dates}</span>
                    <span>{i.expected_attendance}</span>
                  </div>
                </div>
                <div className="flex-shrink-0 text-right">
                  {i.inquiry_type && TYPE_LABELS[i.inquiry_type] && (
                    <div
                      className="inline-block text-[10px] font-semibold tracking-[0.14em] px-3 py-1 rounded-full mb-2"
                      style={{
                        background: '#1a1a1a',
                        color: '#f5f5f5',
                        border: '1px solid rgba(255,255,255,0.1)',
                      }}
                    >
                      {TYPE_LABELS[i.inquiry_type]}
                    </div>
                  )}
                  <div
                    className="inline-block text-[10px] font-semibold tracking-[0.14em] px-3 py-1 rounded-full ml-2 uppercase"
                    style={{
                      background: i.status === 'approved' ? 'rgba(34,197,94,0.15)' : i.status === 'rejected' ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.06)',
                      color: i.status === 'approved' ? '#4ade80' : i.status === 'rejected' ? '#f87171' : '#a0a0a0',
                    }}
                  >
                    {i.status || 'pending'}
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
