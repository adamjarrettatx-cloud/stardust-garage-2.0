import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import ApplicationActions from './ApplicationActions';
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
    <main className="max-w-[860px] mx-auto px-6 py-16">
      <AuthenticatedPageHeader
        backHref="/bananas/applications"
        backLabel="← BACK TO APPLICATIONS"
        title="Membership Application"
        className="mb-6"
      />

      <ProfileHeader
        name={app.full_name}
        photoUrl={app.photo_url}
        subtitle={app.preferred_name ? `goes by ${app.preferred_name}` : null}
        submittedLabel={`Submitted ${formatDate(app.created_at)}`}
        badges={[
          <Pill key="plan">{app.plan === 'cowork-party' ? 'COWORK + PARTY' : 'COWORK'}</Pill>,
          <SubmissionStatusBadge key="status" status={app.status || 'new'} />,
        ]}
        contactRow={
          <>
            <ContactChip label="EMAIL">
              <a href={`mailto:${app.email}`} className="text-[13px] hover:underline" style={{ color: 'var(--auth-text)' }}>
                {app.email}
              </a>
              <ReplyPanel
                submissionType="applications"
                submissionId={app.id}
                toEmail={app.email}
                defaultSubject="Re: Your membership application — Stardust Garage"
                defaultBody={`Hi ${(app.full_name || '').split(' ')[0] || 'there'},\n\nThanks so much for applying for membership at Stardust Garage.\n\n\n\nLooking forward to hearing from you.`}
              />
            </ContactChip>
            {app.phone && (
              <ContactChip label="PHONE">
                <a href={`tel:${app.phone}`} className="text-[13px] hover:underline" style={{ color: 'var(--auth-text)' }}>
                  {app.phone}
                </a>
                <WhatsAppButton phone={app.phone} />
              </ContactChip>
            )}
          </>
        }
      />

      {!app.photo_url && (
        <div
          className="rounded-[12px] px-5 py-4 mb-4 text-[13px] leading-[1.5]"
          style={{ background: 'var(--auth-warn-bg)', border: '1px solid var(--auth-warn-border)', color: 'var(--auth-warn-strong)' }}
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

      <div className="mt-4">
        <DetailSection title="PROFILE">
          <DetailGrid>
            <DetailItem label="INSTAGRAM / SOCIAL">{app.social_handle}</DetailItem>
            <DetailItem label="WEBSITE">
              {app.website ? (
                <a
                  href={app.website.startsWith('http') ? app.website : `https://${app.website}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline break-all"
                >
                  {app.website}
                </a>
              ) : null}
            </DetailItem>
            <DetailItem label="BIRTHDAY">{formatBirthday(app.birthday)}</DetailItem>
          </DetailGrid>
        </DetailSection>

        <DetailSection title="RESPONSES">
          <DetailGrid>
            <DetailItem label="WHAT BRINGS YOU TO STARDUST?" full>{app.why_stardust}</DetailItem>
            <DetailItem label="HOW DID YOU HEAR ABOUT OUR MEMBERSHIPS / WHO REFERRED YOU?" full>{app.how_did_you_hear}</DetailItem>
            <DetailItem label="HOW DO YOU WISH TO CONTRIBUTE TO THE COLLECTIVE?" full>{app.how_contribute}</DetailItem>
            <DetailItem label="WHAT KIND OF EXPERIENCES DO YOU MOST WANT TO SEE HERE?" full>{app.what_experiences}</DetailItem>
          </DetailGrid>
        </DetailSection>

        <DetailSection title="AGREEMENTS" className="mb-0">
          <div className="space-y-2.5 text-[14px]">
            <div className="flex items-start gap-3">
              <span>{app.agreed_ethos ? '✓' : '✗'}</span>
              <span style={{ color: app.agreed_ethos ? 'var(--auth-text)' : 'var(--auth-muted)' }}>
                Uphold the Stardust ethos of respect, awareness, and co-creation
              </span>
            </div>
            <div className="flex items-start gap-3">
              <span>{app.agreed_renewal ? '✓' : '✗'}</span>
              <span style={{ color: app.agreed_renewal ? 'var(--auth-text)' : 'var(--auth-muted)' }}>
                Understands membership renews monthly unless canceled
              </span>
            </div>
            <div className="flex items-start gap-3">
              <span>{app.agreed_house_rules ? '✓' : '✗'}</span>
              <span style={{ color: app.agreed_house_rules ? 'var(--auth-text)' : 'var(--auth-muted)' }}>
                Agrees to follow all house rules, safety guidelines, and consent to culture practices
              </span>
            </div>
          </div>
        </DetailSection>
      </div>
    </main>
  );
}
