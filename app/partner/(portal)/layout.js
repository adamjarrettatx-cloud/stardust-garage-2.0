import { redirect } from 'next/navigation';
import { getCurrentPartner } from '@/lib/auth-helpers';
import PartnerNav from './PartnerNav';

export const revalidate = 0;

// The signed-in partner area. Everything inside this route group requires an
// ACTIVE partner; /partner/login, /partner/activate and /partner/auth/callback
// deliberately sit outside it, because those are how a partner gets a session
// in the first place and gating them would bounce every arrival to the login
// page they were already on.
//
// The route group is what makes that split possible without changing any URL:
// this file wraps /partner/profile and /partner/guest-list only.
//
// middleware.js applies the same two redirects, so in practice nobody reaches
// here unauthenticated. This is the server-side gate that makes each page safe
// on its own if the matcher ever changes.
export default async function PartnerPortalLayout({ children }) {
  const { user, isActivePartner } = await getCurrentPartner();

  if (!user) redirect('/partner/login');
  // Invited but hasn't confirmed their name and photo yet. Not an error —
  // finish the job rather than refusing.
  if (!isActivePartner) redirect('/partner/activate');

  return (
    <div className="min-h-screen">
      <PartnerNav />
      {children}
    </div>
  );
}
