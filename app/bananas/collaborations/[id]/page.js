import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import CollaborationActions from './CollaborationActions';
import SubmissionStatusBadge from '@/app/bananas/components/SubmissionStatusBadge';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';
import { EmailButton, WhatsAppButton } from '@/app/bananas/components/ContactButtons';
import ReplyPanel from '@/app/bananas/components/ReplyPanel';

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
    <div className="py-5 border-t" style={{ borderColor: 'var(--auth-row-border)' }}>
      <div className="text-[11px] font-semibold tracking-[0.14em] mb-2" style={{ color: 'var(--auth-muted)' }}>
        {label}
      </div>
      <div className="text-[15px] leading-[1.6]" style={{ whiteSpace: 'pre-wrap' }}>
        {children || <span style={{ color: 'var(--auth-muted)' }}>—</span>}
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
      <AuthenticatedPageHeader
        backHref="/bananas/collaborations"
        backLabel="← BACK TO COLLABORATIONS"
        title="Collaboration Submission"
        className="mb-8"
      />

      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <div
              className="inline-block text-[10px] font-semibold tracking-[0.14em] px-3 py-1 rounded-full"
              style={{
                background: 'var(--auth-card-bg-alt)',
                color: 'var(--auth-text)',
                border: '1px solid var(--auth-card-border-strong)',
              }}
            >
              {ROLE_LABELS[c.collaborator_type] || c.collaborator_type?.toUpperCase()}
            </div>
            <div
              className="inline-block text-[10px] font-semibold tracking-[0.14em] px-3 py-1 rounded-full"
              style={{
                background: 'var(--auth-card-bg-alt)',
                color: 'var(--auth-text)',
                border: '1px solid var(--auth-card-border-strong)',
              }}
            >
              {c.applying_for?.toUpperCase()}
            </div>
            <SubmissionStatusBadge status={c.status || 'new'} />
          </div>
          <h1
            className="text-[36px] font-extrabold -tracking-[0.02em] leading-[1.1]"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            {c.full_name}
          </h1>
          <p className="text-[12px] mt-3" style={{ color: 'var(--auth-faint)' }}>
            Submitted {formatDate(c.created_at)}
          </p>
        </div>
      </div>

      <CollaborationActions collaborationId={c.id} currentStatus={c.status || 'new'} />

      <section
        className="rounded-[14px] p-8 border mt-8 mb-6"
        style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}
      >
        <h2 className="text-[13px] font-bold tracking-[0.14em] pb-2" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          CONTACT INFO
        </h2>
        <Field label="EMAIL">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <a href={`mailto:${c.email}`} className="hover:underline">{c.email}</a>
            <EmailButton email={c.email} />
          </div>
        </Field>
        <Field label="PHONE">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <a href={`tel:${c.phone}`} className="hover:underline">{c.phone}</a>
            <WhatsAppButton phone={c.phone} />
          </div>
        </Field>
        <Field label="COMPANY / ORGANIZATION">{c.company}</Field>
        <Field label="INSTAGRAM HANDLE">{c.instagram_handle}</Field>
        <ReplyPanel
          submissionType="collaborations"
          submissionId={c.id}
          toEmail={c.email}
          defaultSubject="Re: Your collaboration request — Stardust Garage"
          defaultBody={`Hi ${(c.full_name || '').split(' ')[0] || 'there'},\n\nThanks so much for reaching out about collaborating with Stardust Garage.\n\n\n\nLooking forward to hearing from you.`}
        />
      </section>

      <section
        className="rounded-[14px] p-8 border mb-6"
        style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}
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
