import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import MicroPartyActions from './MicroPartyActions';
import SubmissionStatusBadge from '@/app/bananas/components/SubmissionStatusBadge';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';
import { WhatsAppButton } from '@/app/bananas/components/ContactButtons';
import ReplyPanel from '@/app/bananas/components/ReplyPanel';
import {
  ProfileHeader,
  ContactChip,
  DetailSection,
  DetailGrid,
  DetailItem,
} from '@/app/bananas/components/SubmissionDetail';

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
    <main className="max-w-[860px] mx-auto px-6 py-16">
      <AuthenticatedPageHeader
        backHref="/bananas/micro-parties"
        backLabel="← BACK TO MICRO PARTY INQUIRIES"
        title="Micro Party Inquiry"
        className="mb-6"
      />

      <ProfileHeader
        name={i.event_name || i.full_name}
        subtitle={i.full_name && i.event_name ? `Requested by ${i.full_name}` : null}
        submittedLabel={`Submitted ${formatDate(i.created_at)}`}
        badges={[<SubmissionStatusBadge key="status" status={i.status || 'new'} />]}
        contactRow={
          <>
            <ContactChip label="EMAIL">
              <a href={`mailto:${i.email}`} className="text-[13px] hover:underline" style={{ color: 'var(--auth-text)' }}>
                {i.email}
              </a>
              <ReplyPanel
                submissionType="micro-parties"
                submissionId={i.id}
                toEmail={i.email}
                defaultSubject={`Re: ${i.event_name || 'Your micro party inquiry'} — Stardust Garage`}
                defaultBody={`Hi ${(i.full_name || '').split(' ')[0] || 'there'},\n\nThanks for reaching out about ${i.event_name || 'your micro party'} at Stardust Garage.\n\n\n\nLooking forward to hearing from you.`}
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

      <MicroPartyActions inquiryId={i.id} currentStatus={i.status || 'new'} />

      <div className="mt-4">
        <DetailSection title="EVENT DETAILS">
          <DetailGrid>
            <DetailItem label="EVENT TYPE">{i.event_type}</DetailItem>
            <DetailItem label="MEMBER?">{i.is_member === true ? 'Yes' : i.is_member === false ? 'No' : null}</DetailItem>
            <DetailItem label="REQUESTED DATE">{formatEventDate(i.event_date)}</DetailItem>
            <DetailItem label="START TIME">{formatTime(i.start_time)}</DetailItem>
            <DetailItem label="DURATION">{i.duration_hours ? `${i.duration_hours} hours` : null}</DetailItem>
            <DetailItem label="EXPECTED ATTENDANCE">{i.expected_attendance}</DetailItem>
            <DetailItem label="SELLING TICKETS?">
              {i.selling_tickets === true ? 'Yes' : i.selling_tickets === false ? 'No' : null}
            </DetailItem>
            <DetailItem label="WEBSITE / SOCIAL">{i.website_or_social}</DetailItem>
          </DetailGrid>
        </DetailSection>

        <DetailSection title="VISION & ADDITIONAL INFO">
          <DetailGrid>
            <DetailItem label="EVENT VISION" full>{i.event_vision}</DetailItem>
            <DetailItem label="SPECIAL REQUESTS" full>{i.special_requests}</DetailItem>
            <DetailItem label="HOW THEY HEARD">{i.how_heard}</DetailItem>
            <DetailItem label="TERMS ACKNOWLEDGED">{i.acknowledged_terms ? '✓ Yes' : 'No'}</DetailItem>
          </DetailGrid>
        </DetailSection>
      </div>
    </main>
  );
}
