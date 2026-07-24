import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
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
    <div className="py-5 border-t" style={{ borderColor: 'var(--fg-a06)' }}>
      <div className="text-[11px] font-semibold tracking-[0.14em] mb-2" style={{ color: 'var(--text-3)' }}>
        {label}
      </div>
      <div className="text-[15px] leading-[1.6]" style={{ whiteSpace: 'pre-wrap' }}>
        {children || <span style={{ color: 'var(--text-4)' }}>—</span>}
      </div>
    </div>
  );
}

export default async function ApplicationDetail({ params }) {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

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
        href="/bananas/applications"
        className="inline-block text-[12px] font-semibold tracking-[0.14em] mb-8 transition-opacity hover:opacity-70"
        style={{ color: 'var(--text-3)' }}
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
            style={{ borderRadius: '16px', border: '1px solid var(--surface-5)' }}
          />
        ) : (
          <div
            className="w-[120px] h-[120px] flex-shrink-0 flex items-center justify-center text-[32px] font-bold"
            style={{
              borderRadius: '16px',
              background: 'var(--surface-4)',
              border: '1px solid var(--surface-5)',
              color: 'var(--text-3)',
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
                background: app.plan === 'cowork-party' ? 'var(--text-1)' : 'var(--surface-4)',
                color: app.plan === 'cowork-party' ? '#0a0a0a' : 'var(--text-1)',
                border: '1px solid var(--fg-a1)',
              }}
            >
              {app.plan === 'cowork-party' ? 'COWORK + PARTY' : 'COWORK'}
            </div>
            <div
              className="inline-block text-[10px] font-semibold tracking-[0.14em] px-3 py-1 rounded-full uppercase"
              style={{
                background:
                  app.status === 'approved' ? 'rgba(34,197,94,0.15)' :
                  app.status === 'rejected' ? 'rgba(239,68,68,0.15)' :
                  app.status === 'reviewed' ? 'rgba(168,85,247,0.12)' :
                  app.status === 'pending' ? 'rgba(255,255,255,0.06)' :
                  'rgba(255,184,77,0.15)',
                color:
                  app.status === 'approved' ? 'var(--st-4ade80)' :
                  app.status === 'rejected' ? 'var(--st-f87171)' :
                  app.status === 'reviewed' ? 'var(--st-c084fc)' :
                  app.status === 'pending' ? 'var(--text-3)' :
                  'var(--st-ffb84d)',
              }}
            >
              {app.status || 'new'}
            </div>
          </div>
          <h1
            className="text-[36px] font-extrabold -tracking-[0.02em] leading-[1.1]"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            {app.full_name}
          </h1>
          {app.preferred_name && (
            <p className="text-[15px] mt-1" style={{ color: 'var(--text-3)' }}>
              goes by {app.preferred_name}
            </p>
          )}
          <p className="text-[12px] mt-3" style={{ color: 'var(--text-4)' }}>
            Submitted {formatDate(app.created_at)}
          </p>
        </div>
      </div>

      {!app.photo_url && (
        <div
          className="rounded-[12px] px-5 py-4 mb-6 text-[13px] leading-[1.5]"
          style={{ background: 'var(--st-tint-amber-6)', border: '1px solid var(--st-ffb84d)', color: 'var(--st-ffb84d)' }}
        >
          ⚠ No profile photo — approval will be blocked until a photo is on file.
        </div>
      )}

      <ApplicationActions
        applicationId={app.id}
        currentStatus={app.status || 'new'}
        accountCreated={app.account_created || false}
        hasPhoto={Boolean(app.photo_url)}
      />

      <section
        className="rounded-[14px] p-8 border mt-8 mb-6"
        style={{ background: 'var(--surface-1)', borderColor: 'var(--fg-a05)' }}
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
        style={{ background: 'var(--surface-1)', borderColor: 'var(--fg-a05)' }}
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
        style={{ background: 'var(--surface-1)', borderColor: 'var(--fg-a05)' }}
      >
        <h2 className="text-[13px] font-bold tracking-[0.14em] mb-4" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          AGREEMENTS
        </h2>
        <div className="space-y-2.5 text-[14px]">
          <div className="flex items-start gap-3">
            <span>{app.agreed_ethos ? '✓' : '✗'}</span>
            <span style={{ color: app.agreed_ethos ? 'var(--text-1)' : 'var(--text-4)' }}>
              Uphold the Stardust ethos of respect, awareness, and co-creation
            </span>
          </div>
          <div className="flex items-start gap-3">
            <span>{app.agreed_renewal ? '✓' : '✗'}</span>
            <span style={{ color: app.agreed_renewal ? 'var(--text-1)' : 'var(--text-4)' }}>
              Understands membership renews monthly unless canceled
            </span>
          </div>
          <div className="flex items-start gap-3">
            <span>{app.agreed_house_rules ? '✓' : '✗'}</span>
            <span style={{ color: app.agreed_house_rules ? 'var(--text-1)' : 'var(--text-4)' }}>
              Agrees to follow all house rules, safety guidelines, and consent to culture practices
            </span>
          </div>
        </div>
      </section>
    </main>
  );
}
