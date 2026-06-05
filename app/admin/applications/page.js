import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

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

function initials(name) {
  if (!name) return '?';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('') || '?';
}

function Avatar({ application }) {
  if (application.photo_url) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={application.photo_url}
        alt={application.full_name}
        className="w-11 h-11 flex-shrink-0 object-cover"
        style={{ borderRadius: '50%', border: '1px solid #2a2a2a' }}
      />
    );
  }
  return (
    <div
      className="w-11 h-11 flex-shrink-0 flex items-center justify-center text-[14px] font-bold"
      style={{
        borderRadius: '50%',
        background: '#1a1a1a',
        border: '1px solid #2a2a2a',
        color: '#8a8a8a',
        fontFamily: "'Plus Jakarta Sans', sans-serif",
      }}
    >
      {initials(application.full_name)}
    </div>
  );
}

export default async function ApplicationsPage() {
  const supabase = await createClient();
  const { data: applications } = await supabase
    .from('membership_applications')
    .select('*')
    .order('created_at', { ascending: false });

  const total = applications?.length || 0;
  const pending = applications?.filter((a) => a.status === 'pending').length || 0;
  const approved = applications?.filter((a) => a.status === 'approved').length || 0;

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
          <p style={{ color: '#8a8a8a' }}>No applications yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {applications.map((a) => (
            <Link
              key={a.id}
              href={`/admin/applications/${a.id}`}
              className="block rounded-[14px] p-6 border transition-colors hover:border-white/20"
              style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.05)' }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-4 flex-1 min-w-0">
                  <Avatar application={a} />
                  <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="text-[18px] font-bold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                      {a.full_name}
                    </h3>
                    {a.preferred_name && (
                      <span className="text-[13px]" style={{ color: '#8a8a8a' }}>
                        ({a.preferred_name})
                      </span>
                    )}
                  </div>
                  <div className="text-[13px] flex flex-wrap gap-x-4 gap-y-1" style={{ color: '#8a8a8a' }}>
                    <span>{a.email}</span>
                    <span>{a.phone}</span>
                    <span>{a.social_handle}</span>
                  </div>
                  </div>
                </div>
                <div className="flex-shrink-0 text-right">
                  <div
                    className="inline-block text-[10px] font-semibold tracking-[0.14em] px-3 py-1 rounded-full mb-2"
                    style={{
                      background: a.plan === 'cowork-party' ? '#f5f5f5' : '#1a1a1a',
                      color: a.plan === 'cowork-party' ? '#0a0a0a' : '#f5f5f5',
                      border: '1px solid rgba(255,255,255,0.1)',
                    }}
                  >
                    {a.plan === 'cowork-party' ? 'COWORK + PARTY' : 'COWORK'}
                  </div>
                  <div className="text-[11px]" style={{ color: '#666' }}>
                    {formatDate(a.created_at)}
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
