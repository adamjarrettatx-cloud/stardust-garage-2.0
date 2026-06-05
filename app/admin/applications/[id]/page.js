import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import ApplicationActions from './ApplicationActions';

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

function formatBirthday(dateString) {
  if (!dateString) return '';
  const d = new Date(dateString + 'T00:00:00');
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
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

function Field({ label, children }) {
  return (
    <div className="py-5 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
      <div className="text-[11px] font-semibold tracking-[0.14em] mb-2" style={{ color: '#8a8a8a' }}>
        {label}
      </div>
      <div className="text-[15px] leading-[1.6]" style={{ whiteSpace: 'pre-wrap' }}>
        {children || <span style={{ color: '#555' }}>—</span>}
      </div>
    </div>
  );
}

export default async function ApplicationDetail({ params }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: app, error } = await supabase
    .from('membership_applications')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !app) notFound();

  return (
    <main className="max-w-[800px] mx-auto px-6 py-16">
      <Link
        href="/admin/applications"
        className="inline-block text-[12px] font-semibold tracking-[0.14em] mb-8 transition-opacity hover:opacity-70"
        style={{ color: '#8a8a8a' }}
      >
        ← BACK TO APPLICATIONS
      </Link>

      <div className="flex items-start gap-5 mb-8">
        {app.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={app.photo_url}
            alt={app.full_name}
            className="w-[120px] h-[120px] flex-shrink-0 object-cover"
            style={{ borderRadius: '16px', border: '1px solid #2a2a2a' }}
          />
        ) : (
          <div
            className="w-[120px] h-[120px] flex-shrink-0 flex items-center justify-center text-[32px] font-bold"
            style={{
              borderRadius: '16px',
              background: '#1a1a1a',
              border: '1px solid #2a2a2a',
              color: '#8a8a8a',
              fontFamily: "'Plus Jakarta Sans', sans-serif",
            }}
          >
            {initials(app.full_name)}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-3">
            <div
              className="inline-block text-[10px] font-semibold tracking-[0.14em] px-3 py-1 rounded-full"
              style={{
                background: app.plan === 'cowork-party' ? '#f5f5f5' : '#1a1a1a',
                color: app.plan === 'cowork-party' ? '#0a0a0a' : '#f5f5f5',
                border: '1px solid rgba(255,255,255,0.1)',
              }}
            >
              {app.plan === 'cowork-party' ? 'COWORK + PARTY' : 'COWORK'}
            </div>
            <div
              className="inline-block text-[10px] font-semibold tracking-[0.14em] px-3 py-1 rounded-full uppercase"
              style={{
                background: app.status === 'approved' ? 'rgba(34,197,94,0.15)' : app.status === 'rejected' ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.06)',
                color: app.status === 'approved' ? '#4ade80' : app.status === 'rejected' ? '#f87171' : '#a0a0a0',
              }}
            >
              {app.status || 'pending'}
            </div>
          </div>
          <h1
            className="text-[36px] font-extrabold -tracking-[0.02em] leading-[1.1]"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            {app.full_name}
          </h1>
          {app.preferred_name && (
            <p className="text-[15px] mt-1" style={{ color: '#8a8a8a' }}>
              goes by {app.preferred_name}
            </p>
          )}
          <p className="text-[12px] mt-3" style={{ color: '#666' }}>
            Submitted {formatDate(app.created_at)}
          </p>
        </div>
      </div>

      {!app.photo_url && (
        <div
          className="rounded-[12px] px-5 py-4 mb-6 text-[13px] leading-[1.5]"
          style={{ background: '#1a1400', border: '1px solid #ffb84d', color: '#ffb84d' }}
        >
          ⚠ No profile photo — approval will be blocked until a photo is on file.
        </div>
      )}

      <ApplicationActions
        applicationId={app.id}
        currentStatus={app.status || 'pending'}
        accountCreated={app.account_created || false}
        hasPhoto={Boolean(app.photo_url)}
      />

      <section
        className="rounded-[14px] p-8 border mt-8 mb-6"
        style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.05)' }}
      >
        <h2 className="text-[13px] font-bold tracking-[0.14em] pb-2" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          CONTACT
        </h2>
        <Field label="EMAIL">
          <a href={`mailto:${app.email}`} className="hover:underline">{app.email}</a>
        </Field>
        <Field label="PHONE">
          <a href={`tel:${app.phone}`} className="hover:underline">{app.phone}</a>
        </Field>
        <Field label="INSTAGRAM / SOCIAL">{app.social_handle}</Field>
        <Field label="WEBSITE">
          {app.website ? (
            <a href={app.website.startsWith('http') ? app.website : `https://${app.website}`} target="_blank" rel="noopener noreferrer" className="hover:underline">
              {app.website}
            </a>
          ) : null}
        </Field>
        <Field label="BIRTHDAY">{formatBirthday(app.birthday)}</Field>
      </section>

      <section
        className="rounded-[14px] p-8 border mb-6"
        style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.05)' }}
      >
        <h2 className="text-[13px] font-bold tracking-[0.14em] pb-2" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          RESPONSES
        </h2>
        <Field label="WHAT BRINGS YOU TO STARDUST?">{app.why_stardust}</Field>
        <Field label="HOW DID YOU HEAR ABOUT OUR MEMBERSHIPS / WHO REFERRED YOU?">{app.how_did_you_hear}</Field>
        <Field label="HOW DO YOU WISH TO CONTRIBUTE TO THE COLLECTIVE?">{app.how_contribute}</Field>
        <Field label="WHAT KIND OF EXPERIENCES DO YOU MOST WANT TO SEE HERE?">{app.what_experiences}</Field>
      </section>

      <section
        className="rounded-[14px] p-8 border"
        style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.05)' }}
      >
        <h2 className="text-[13px] font-bold tracking-[0.14em] mb-4" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          AGREEMENTS
        </h2>
        <div className="space-y-2.5 text-[14px]">
          <div className="flex items-start gap-3">
            <span>{app.agreed_ethos ? '✓' : '✗'}</span>
            <span style={{ color: app.agreed_ethos ? '#f5f5f5' : '#888' }}>
              Uphold the Stardust ethos of respect, awareness, and co-creation
            </span>
          </div>
          <div className="flex items-start gap-3">
            <span>{app.agreed_renewal ? '✓' : '✗'}</span>
            <span style={{ color: app.agreed_renewal ? '#f5f5f5' : '#888' }}>
              Understands membership renews monthly unless canceled
            </span>
          </div>
          <div className="flex items-start gap-3">
            <span>{app.agreed_house_rules ? '✓' : '✗'}</span>
            <span style={{ color: app.agreed_house_rules ? '#f5f5f5' : '#888' }}>
              Agrees to follow all house rules, safety guidelines, and consent to culture practices
            </span>
          </div>
        </div>
      </section>
    </main>
  );
}
