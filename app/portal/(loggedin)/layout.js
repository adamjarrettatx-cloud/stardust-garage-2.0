import { redirect } from 'next/navigation';
import { getCurrentPartner } from '@/lib/auth-helpers';
import { portalName } from '@/lib/role-label';
import PortalNav from './PortalNav';

export const revalidate = 0;

export async function generateMetadata() {
  const { partner } = await getCurrentPartner();
  const name = portalName(partner?.contact_type);
  return { title: `${name} · Stardust Garage` };
}

// The signed-in partner area. Everything inside this route group requires an
// ACTIVE partner; /portal/login, /portal/activate and /portal/auth/callback
// deliberately sit outside it, because those are how a partner gets a session
// in the first place and gating them would bounce every arrival to the login
// page they were already on.
//
// The route group is what makes that split possible without changing any URL:
// this file wraps /portal/profile and /portal/guest-list only.
//
// middleware.js applies the same two redirects, so in practice nobody reaches
// here unauthenticated. This is the server-side gate that makes each page safe
// on its own if the matcher ever changes.
export default async function PartnerPortalLayout({ children }) {
  const { user, partner, isActivePartner } = await getCurrentPartner();

  if (!user) redirect('/portal/login');
  // Invited but hasn't confirmed their name and photo yet. Not an error —
  // finish the job rather than refusing.
  if (!isActivePartner) redirect('/portal/activate');

  return (
    <div className="min-h-screen">
      <PortalNav contactType={partner?.contact_type} />
      {children}
    </div>
  );
}
