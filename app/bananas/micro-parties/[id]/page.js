import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import MicroPartyActions from './MicroPartyActions';
import SubmissionStatusBadge from '@/app/bananas/components/SubmissionStatusBadge';

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
  if (!dateString) return null;
  return new Date(dateString + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatTime(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 || 12;
  return `${hour12}:${m.toString().padStart(2, '0')} ${period}`;
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

export default async function MicroPartyDetail({ params }) {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const { id } = await params;
  const supabase = await createClient();
  const { data: i, error } = await supabase
    .from('micro_party_inquiries')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !i) notFound();

  return (
    <main className="max-w-[800px] mx-auto px-6 py-16">
      <Link
        href="/bananas/micro-parties"
        className="auth-theme-page-link inline-block text-[12px] font-semibold tracking-[0.14em] mb-8 transition-colors"
      >
        ← BACK TO MICRO PARTY INQUIRIES
      </Link>

      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1
            className="text-[36px] font-extrabold -tracking-[0.02em] leading-[1.1] mb-2"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            {i.event_name || i.full_name}
          </h1>
          <div className="text-[13px]" style={{ color: 'var(--auth-muted)' }}>
            Submitted {formatDate(i.created_at)}
          </div>
        </div>

        <SubmissionStatusBadge status={i.status || 'new'} />
      </div>

      <MicroPartyActions inquiryId={i.id} currentStatus={i.status || 'new'} />

      <section
        className="rounded-[14px] p-7 border mt-10"
        style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}
      >
        <h2 className="text-[16px] font-bold mb-1" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          Contact Info
        </h2>

        <Field label="FULL NAME">{i.full_name}</Field>
        <Field label="EMAIL">
          <a href={`mailto:${i.email}`} style={{ color: 'var(--auth-text)', textDecoration: 'underline' }}>
            {i.email}
          </a>
        </Field>
        <Field label="PHONE">{i.phone}</Field>
        <Field label="MEMBER?">
          {i.is_member === true ? 'Yes' : i.is_member === false ? 'No' : null}
        </Field>
        <Field label="WEBSITE / SOCIAL">{i.website_or_social}</Field>
      </section>

      <section
        className="rounded-[14px] p-7 border mt-6"
        style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}
      >
        <h2 className="text-[16px] font-bold mb-1" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          Event Details
        </h2>

        <Field label="EVENT NAME">{i.event_name}</Field>
        <Field label="EVENT TYPE">{i.event_type}</Field>
        <Field label="REQUESTED DATE">{formatEventDate(i.event_date)}</Field>
        <Field label="START TIME">{formatTime(i.start_time)}</Field>
        <Field label="DURATION">{i.duration_hours ? `${i.duration_hours} hours` : null}</Field>
        <Field label="EXPECTED ATTENDANCE">{i.expected_attendance}</Field>
        <Field label="SELLING TICKETS?">
          {i.selling_tickets === true ? 'Yes' : i.selling_tickets === false ? 'No' : null}
        </Field>
      </section>

      <section
        className="rounded-[14px] p-7 border mt-6"
        style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}
      >
        <h2 className="text-[16px] font-bold mb-1" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          Vision &amp; Additional Info
        </h2>

        <Field label="EVENT VISION">{i.event_vision}</Field>
        <Field label="SPECIAL REQUESTS">{i.special_requests}</Field>
        <Field label="HOW THEY HEARD">{i.how_heard}</Field>
        <Field label="TERMS ACKNOWLEDGED">
          {i.acknowledged_terms ? '✓ Yes' : 'No'}
        </Field>
      </section>
    </main>
  );
}
