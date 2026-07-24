import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import CollaborationActions from './CollaborationActions';

export const revalidate = 0;

const ROLE_LABELS = {
  'djs': 'DJ',
  'artists': 'ARTIST',
};

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

export default async function CollaborationDetail({ params }) {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const { id } = await params;
  const supabase = await createClient();
  const { data: c, error } = await supabase
    .from('collaborations')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !c) notFound();

  return (
    <main className="max-w-[800px] mx-auto px-6 py-16">
      <Link
        href="/bananas/collaborations"
        className="inline-block text-[12px] font-semibold tracking-[0.14em] mb-8 transition-opacity hover:opacity-70"
        style={{ color: 'var(--text-3)' }}
      >
        ← BACK TO COLLABORATIONS
      </Link>

      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <div
              className="inline-block text-[10px] font-semibold tracking-[0.14em] px-3 py-1 rounded-full"
              style={{
                background: 'var(--surface-4)',
                color: 'var(--text-1)',
                border: '1px solid var(--fg-a1)',
              }}
            >
              {ROLE_LABELS[c.collaborator_type] || c.collaborator_type?.toUpperCase()}
            </div>
            <div
              className="inline-block text-[10px] font-semibold tracking-[0.14em] px-3 py-1 rounded-full"
              style={{
                background: 'var(--surface-4)',
                color: 'var(--text-1)',
                border: '1px solid var(--fg-a1)',
              }}
            >
              {c.applying_for?.toUpperCase()}
            </div>
            <div
              className="inline-block text-[10px] font-semibold tracking-[0.14em] px-3 py-1 rounded-full uppercase"
              style={{
                background:
                  c.status === 'approved' ? 'rgba(34,197,94,0.15)' :
                  c.status === 'rejected' ? 'rgba(239,68,68,0.15)' :
                  c.status === 'reviewed' ? 'rgba(168,85,247,0.12)' :
                  c.status === 'pending' ? 'rgba(255,255,255,0.06)' :
                  'rgba(255,184,77,0.15)',
                color:
                  c.status === 'approved' ? 'var(--st-4ade80)' :
                  c.status === 'rejected' ? 'var(--st-f87171)' :
                  c.status === 'reviewed' ? 'var(--st-c084fc)' :
                  c.status === 'pending' ? 'var(--text-3)' :
                  'var(--st-ffb84d)',
              }}
            >
              {c.status || 'new'}
            </div>
          </div>
          <h1
            className="text-[36px] font-extrabold -tracking-[0.02em] leading-[1.1]"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            {c.full_name}
          </h1>
          <p className="text-[12px] mt-3" style={{ color: 'var(--text-4)' }}>
            Submitted {formatDate(c.created_at)}
          </p>
        </div>
      </div>

      <CollaborationActions collaborationId={c.id} currentStatus={c.status || 'new'} />

      <section
        className="rounded-[14px] p-8 border mt-8 mb-6"
        style={{ background: 'var(--surface-1)', borderColor: 'var(--fg-a05)' }}
      >
        <h2 className="text-[13px] font-bold tracking-[0.14em] pb-2" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          CONTACT INFO
        </h2>
        <Field label="EMAIL">
          <a href={`mailto:${c.email}`} className="hover:underline">{c.email}</a>
        </Field>
        <Field label="PHONE">
          <a href={`tel:${c.phone}`} className="hover:underline">{c.phone}</a>
        </Field>
        <Field label="COMPANY / ORGANIZATION">{c.company}</Field>
        <Field label="INSTAGRAM HANDLE">{c.instagram_handle}</Field>
      </section>

      <section
        className="rounded-[14px] p-8 border mb-6"
        style={{ background: 'var(--surface-1)', borderColor: 'var(--fg-a05)' }}
      >
        <h2 className="text-[13px] font-bold tracking-[0.14em] pb-2" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          ABOUT
        </h2>
        <Field label="APPLYING / INTERESTED IN">{c.applying_for}</Field>
        <Field label="EXPERIENCE / WHAT THEY OFFER">{c.experience}</Field>
        <Field label="PORTFOLIO / CONTENT SAMPLE">
          {c.portfolio_link ? (
            <a
              href={c.portfolio_link.startsWith('http') ? c.portfolio_link : `https://${c.portfolio_link}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline break-all"
            >
              {c.portfolio_link}
            </a>
          ) : null}
        </Field>
        <Field label="ADDITIONAL INFO">{c.additional_info}</Field>
      </section>
    </main>
  );
}
