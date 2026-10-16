import { redirect } from 'next/navigation';
import { ownerPageGate, getMfaStatus } from '@/lib/auth-helpers';
import { VIEW_PERSONAS } from '@/lib/view-portal/personas';
import { viewPortalStatus } from '@/lib/view-portal/config';
import ViewPortalClient from './ViewPortalClient';

export const metadata = { title: 'View Portal · Stardust Garage' };
export const dynamic = 'force-dynamic';
export default async function ViewPortalPage() {
  const gate = await ownerPageGate();
  if (gate.redirect) redirect(gate.redirect);
  if (gate.user?.id !== process.env.VIEW_PORTAL_OWNER_USER_ID) redirect('/bananas');
  const mfa = await getMfaStatus();
  if (!mfa.mfaSatisfied) redirect('/bananas/security?mfa=required&next=/bananas/view-portal');
  const status = viewPortalStatus();
  return (
    <section>
      <ViewPortalClient
        personas={VIEW_PERSONAS}
        ready={status.ready}
        statusMessage={status.message}
        taxonomyNote="Contact profile types follow the Contacts directory: Persons includes Artists and Promoters; Organizations includes Collectives and Event Organizers. Customer memberships and staff permissions remain separate account capabilities."
      />
    </section>
  );
}
