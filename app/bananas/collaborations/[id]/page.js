import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import CollaborationActions from './CollaborationActions';
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

const ROLE_LABELS = {
  'djs': 'DJ',
  'artists': 'ARTIST',
  'internship': 'INTERNSHIP',
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
    <div className="max-w-[860px]">
      <AuthenticatedPageHeader
        backHref="/bananas/collaborations"
        backLabel="← BACK TO COLLABORATIONS"
        title="Collaboration Submission"
        className="mb-6"
      />

      <ProfileHeader
        name={c.full_name}
        subtitle={c.instagram_handle}
        submittedLabel={`Submitted ${formatDate(c.created_at)}`}
        badges={[
          <Pill key="role">{ROLE_LABELS[c.collaborator_type] || c.collaborator_type?.toUpperCase()}</Pill>,
          c.applying_for ? <Pill key="applying">{c.applying_for?.toUpperCase()}</Pill> : null,
          <SubmissionStatusBadge key="status" status={c.status || 'new'} />,
        ]}
        contactRow={
          <>
            <ContactChip label="EMAIL">
              <a href={`mailto:${c.email}`} className="text-[13px] hover:underline" style={{ color: 'var(--auth-text)' }}>
                {c.email}
              </a>
              <ReplyPanel
                submissionType="collaborations"
                submissionId={c.id}
                toEmail={c.email}
                defaultSubject="Re: Your collaboration request — Stardust Garage"
                defaultBody={`Hi ${(c.full_name || '').split(' ')[0] || 'there'},\n\nThanks so much for reaching out about collaborating with Stardust Garage.\n\n\n\nLooking forward to hearing from you.`}
              />
            </ContactChip>
            {c.phone && (
              <ContactChip label="PHONE">
                <a href={`tel:${c.phone}`} className="text-[13px] hover:underline" style={{ color: 'var(--auth-text)' }}>
                  {c.phone}
                </a>
                <WhatsAppButton phone={c.phone} />
              </ContactChip>
            )}
          </>
        }
      />

      <CollaborationActions collaborationId={c.id} currentStatus={c.status || 'new'} />

      <div className="mt-4">
        <DetailSection title="ABOUT" className="mb-0">
          <DetailGrid>
            <DetailItem label="COMPANY / ORGANIZATION">{c.company}</DetailItem>
            <DetailItem label="APPLYING / INTERESTED IN">{c.applying_for}</DetailItem>
            <DetailItem label="PORTFOLIO / CONTENT SAMPLE">
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
            </DetailItem>
            <DetailItem label="EXPERIENCE / WHAT THEY OFFER" full>{c.experience}</DetailItem>
            <DetailItem label="ADDITIONAL INFO" full>{c.additional_info}</DetailItem>
          </DetailGrid>
        </DetailSection>
      </div>
    </div>
  );
}
