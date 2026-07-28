import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import InquiryActions from './InquiryActions';
import SubmissionStatusBadge from '@/app/bananas/components/SubmissionStatusBadge';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';
import { EmailButton, WhatsAppButton } from '@/app/bananas/components/ContactButtons';

export const revalidate = 0;

const TYPE_LABELS = {
  'micro-parties': 'Micro Parties / Birthdays',
  'host-your-own': 'Host-Your-Own Experiences',
  'entire-space': 'Entire Space',
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

export default async function InquiryDetail({ params }) {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const { id } = await params;
  const supabase = await createClient();
  const { data: i, error } = await supabase
    .from('venue_inquiries')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !i) notFound();

  return (
    <main className="max-w-[800px] mx-auto px-6 py-16">
      <AuthenticatedPageHeader
        backHref="/bananas/venue-inquiries"
        backLabel="← BACK TO INQUIRIES"
        title="Venue Inquiry"
        className="mb-8"
      />

      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            {i.inquiry_type && TYPE_LABELS[i.inquiry_type] && (
              <div
                className="inline-block text-[10px] font-semibold tracking-[0.14em] px-3 py-1 rounded-full"
                style={{
                  background: 'var(--auth-card-bg-alt)',
                  color: 'var(--auth-text)',
                  border: '1px solid var(--auth-card-border-strong)',
                }}
              >
                {TYPE_LABELS[i.inquiry_type].toUpperCase()}
              </div>
            )}
            <SubmissionStatusBadge status={i.status || 'new'} />
          </div>
          <h1
            className="text-[36px] font-extrabold -tracking-[0.02em] leading-[1.1]"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            {i.event_name}
          </h1>
          <p className="text-[15px] mt-1" style={{ color: 'var(--auth-muted)' }}>
            {i.event_type}
          </p>
          <p className="text-[12px] mt-3" style={{ color: 'var(--auth-faint)' }}>
            Submitted {formatDate(i.created_at)}
          </p>
        </div>
      </div>

      <InquiryActions inquiryId={i.id} currentStatus={i.status || 'new'} />

      <section
        className="rounded-[14px] p-8 border mt-8 mb-6"
        style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}
      >
        <h2 className="text-[13px] font-bold tracking-[0.14em] pb-2" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          CONTACT
        </h2>
        <Field label="FULL NAME">{i.full_name}</Field>
        <Field label="EMAIL">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <a href={`mailto:${i.email}`} className="hover:underline">{i.email}</a>
            <EmailButton email={i.email} />
          </div>
        </Field>
        <Field label="PHONE">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <a href={`tel:${i.phone}`} className="hover:underline">{i.phone}</a>
            <WhatsAppButton phone={i.phone} />
          </div>
        </Field>
        <Field label="COMPANY / ORGANIZATION">{i.company}</Field>
        <Field label="WEBSITE / SOCIAL">
          {i.website ? (
            <a href={i.website.startsWith('http') ? i.website : `https://${i.website}`} target="_blank" rel="noopener noreferrer" className="hover:underline">
              {i.website}
            </a>
          ) : null}
        </Field>
      </section>

      <section
        className="rounded-[14px] p-8 border mb-6"
        style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}
      >
        <h2 className="text-[13px] font-bold tracking-[0.14em] pb-2" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          EVENT DETAILS
        </h2>
        <Field label="PREFERRED DATE(S)">{i.preferred_dates}</Field>
        <Field label="EVENT DURATION">{i.event_duration}</Field>
        <Field label="EXPECTED ATTENDANCE">{i.expected_attendance}</Field>
        <Field label="PREFERRED SETUP">{i.preferred_setup}</Field>
        <Field label="BUDGET RANGE">{i.budget_range}</Field>
      </section>

      <section
        className="rounded-[14px] p-8 border mb-6"
        style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}
      >
        <h2 className="text-[13px] font-bold tracking-[0.14em] pb-2" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          SPACE &amp; PRODUCTION
        </h2>
        <Field label="AREAS NEEDED">
          {i.areas_needed && i.areas_needed.length > 0 ? (
            <div className="flex flex-wrap gap-2 mt-1">
              {i.areas_needed.map((area) => (
                <span
                  key={area}
                  className="text-[12px] font-medium px-3 py-1 rounded-full"
                  style={{ background: 'var(--auth-card-bg-alt)', border: '1px solid var(--auth-card-border-strong)' }}
                >
                  {area}
                </span>
              ))}
            </div>
          ) : null}
        </Field>
        <Field label="PRODUCTION ELEMENTS">{i.production_elements}</Field>
        <Field label="NEEDS SETUP/TEARDOWN TIME?">{i.needs_setup_teardown}</Field>
        <Field label="SETUP/TEARDOWN DETAILS">{i.setup_teardown_details}</Field>
      </section>

      <section
        className="rounded-[14px] p-8 border mb-6"
        style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}
      >
        <h2 className="text-[13px] font-bold tracking-[0.14em] pb-2" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          VISION &amp; ADDITIONAL INFO
        </h2>
        <Field label="EVENT VISION">{i.event_vision}</Field>
        <Field label="OUTSIDE VENDORS?">{i.outside_vendors}</Field>
        <Field label="COLLABORATION / CO-PRODUCTION?">{i.collaboration}</Field>
        <Field label="SPECIAL REQUIREMENTS">{i.special_requirements}</Field>
        <Field label="HOW DID YOU HEAR">{i.how_did_you_hear}</Field>
      </section>

      <section
        className="rounded-[14px] p-8 border"
        style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}
      >
        <h2 className="text-[13px] font-bold tracking-[0.14em] mb-4" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          ACKNOWLEDGMENT
        </h2>
        <div className="flex items-start gap-3 text-[14px]">
          <span>{i.acknowledged_terms ? '✓' : '✗'}</span>
          <span style={{ color: i.acknowledged_terms ? 'var(--auth-text)' : 'var(--auth-muted)' }}>
            Acknowledged Stardust Garage is an intentional, creative venue and rentals are subject to management approval.
          </span>
        </div>
      </section>
    </main>
  );
}
