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
      <header className="mb-8 max-w-3xl">
        <p className="text-[12px] uppercase tracking-[.14em] font-extrabold" style={{ color: 'var(--auth-accent)' }}>Owner only</p>
        <h1 className="mt-2 text-[30px] font-extrabold -tracking-[.02em]" style={{ color: 'var(--auth-text)' }}>View Portal</h1>
        <p className="mt-3 text-[15px] leading-7" style={{ color: 'var(--auth-muted)' }}>
          Walk the complete website as a fixed synthetic account. The preview runs on an isolated hostname and database, so the selected view is enforced by its real permissions rather than your owner access.
        </p>
        <p className="mt-3 text-[14px] leading-6" style={{ color: 'var(--auth-muted)' }}>
          Contact profile types follow the Contacts directory: Persons includes Artists and Promoters; Organizations includes Collectives and Event Organizers. Customer memberships and staff permissions remain separate account capabilities.
        </p>
      </header>
      <ViewPortalClient personas={VIEW_PERSONAS} ready={status.ready} statusMessage={status.message} />
    </section>
  );
}
