import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import InquiryActions from './InquiryActions';
import SubmissionStatusBadge from '@/app/bananas/components/SubmissionStatusBadge';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';
import { WhatsAppButton } from '@/app/bananas/components/ContactButtons';
import ReplyPanel from '@/app/bananas/components/ReplyPanel';
import {
  ProfileHeader,
  ContactChip,
  Pill,
  DetailSection,
  DetailGrid,
  DetailItem,
} from '@/app/bananas/components/SubmissionDetail';

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
    <main className="max-w-[860px] mx-auto px-6 py-16">
      <AuthenticatedPageHeader
        backHref="/bananas/venue-inquiries"
        backLabel="← BACK TO INQUIRIES"
        title="Venue Inquiry"
        className="mb-6"
      />

      <ProfileHeader
        name={i.event_name}
        subtitle={[i.full_name, i.event_type].filter(Boolean).join(' · ') || null}
        submittedLabel={`Submitted ${formatDate(i.created_at)}`}
        badges={[
          i.inquiry_type && TYPE_LABELS[i.inquiry_type] ? (
            <Pill key="type">{TYPE_LABELS[i.inquiry_type].toUpperCase()}</Pill>
          ) : null,
          <SubmissionStatusBadge key="status" status={i.status || 'new'} />,
        ]}
        contactRow={
          <>
            <ContactChip label="EMAIL">
              <a href={`mailto:${i.email}`} className="text-[13px] hover:underline" style={{ color: 'var(--auth-text)' }}>
                {i.email}
              </a>
              <ReplyPanel
                submissionType="venue-inquiries"
                submissionId={i.id}
                toEmail={i.email}
                defaultSubject={`Re: ${i.event_name || 'Your venue inquiry'} — Stardust Garage`}
                defaultBody={`Hi ${(i.full_name || '').split(' ')[0] || 'there'},\n\nThanks for reaching out about ${i.event_name || 'your event'} at Stardust Garage.\n\n\n\nLooking forward to hearing from you.`}
              />
            </ContactChip>
            {i.phone && (
              <ContactChip label="PHONE">
                <a href={`tel:${i.phone}`} className="text-[13px] hover:underline" style={{ color: 'var(--auth-text)' }}>
                  {i.phone}
                </a>
                <WhatsAppButton phone={i.phone} />
              </ContactChip>
            )}
          </>
        }
      />

      <InquiryActions inquiryId={i.id} currentStatus={i.status || 'new'} />

      <div className="mt-4">
        <DetailSection title="CONTACT & EVENT DETAILS">
          <DetailGrid>
            <DetailItem label="COMPANY / ORGANIZATION">{i.company}</DetailItem>
            <DetailItem label="WEBSITE / SOCIAL">
              {i.website ? (
                <a
                  href={i.website.startsWith('http') ? i.website : `https://${i.website}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline break-all"
                >
                  {i.website}
                </a>
              ) : null}
            </DetailItem>
            <DetailItem label="PREFERRED DATE(S)">{i.preferred_dates}</DetailItem>
            <DetailItem label="EVENT DURATION">{i.event_duration}</DetailItem>
            <DetailItem label="EXPECTED ATTENDANCE">{i.expected_attendance}</DetailItem>
            <DetailItem label="BUDGET RANGE">{i.budget_range}</DetailItem>
            <DetailItem label="PREFERRED SETUP" full>{i.preferred_setup}</DetailItem>
          </DetailGrid>
        </DetailSection>

        <DetailSection title="SPACE & PRODUCTION">
          <DetailGrid>
            <DetailItem label="AREAS NEEDED" full>
              {i.areas_needed && i.areas_needed.length > 0 ? (
                <div className="flex flex-wrap gap-2">
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
            </DetailItem>
            <DetailItem label="NEEDS SETUP/TEARDOWN TIME?">{i.needs_setup_teardown}</DetailItem>
            <DetailItem label="OUTSIDE VENDORS?">{i.outside_vendors}</DetailItem>
            <DetailItem label="PRODUCTION ELEMENTS" full>{i.production_elements}</DetailItem>
            <DetailItem label="SETUP/TEARDOWN DETAILS" full>{i.setup_teardown_details}</DetailItem>
          </DetailGrid>
        </DetailSection>

        <DetailSection title="VISION & ADDITIONAL INFO">
          <DetailGrid>
            <DetailItem label="EVENT VISION" full>{i.event_vision}</DetailItem>
            <DetailItem label="COLLABORATION / CO-PRODUCTION?">{i.collaboration}</DetailItem>
            <DetailItem label="HOW DID YOU HEAR">{i.how_did_you_hear}</DetailItem>
            <DetailItem label="SPECIAL REQUIREMENTS" full>{i.special_requirements}</DetailItem>
          </DetailGrid>
        </DetailSection>

        <DetailSection title="ACKNOWLEDGMENT" className="mb-0">
          <div className="flex items-start gap-3 text-[14px]">
            <span>{i.acknowledged_terms ? '✓' : '✗'}</span>
            <span style={{ color: i.acknowledged_terms ? 'var(--auth-text)' : 'var(--auth-muted)' }}>
              Acknowledged Stardust Garage is an intentional, creative venue and rentals are subject to management approval.
            </span>
          </div>
        </DetailSection>
      </div>
    </main>
  );
}
