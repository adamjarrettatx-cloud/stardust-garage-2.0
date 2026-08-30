import { redirect } from 'next/navigation';
import { getCurrentPartner } from '@/lib/auth-helpers';
import { portalName, canSignContracts } from '@/lib/role-label';
import { createClient } from '@/lib/supabase/server';
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

  // Does this partner have any contract to look at? Only asked when the nav
  // wouldn't already show the tab for their type, so the common case costs
  // nothing. partner_contracts() is the same SECURITY DEFINER read the page uses:
  // it returns only this partner's non-draft contracts and only safe columns.
  let hasContracts = false;
  if (!canSignContracts(partner?.contact_type)) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('partner_contracts');
    if (error) {
      // A missing/failed RPC must not blank the whole portal shell — worst case
      // the tab is hidden for a type that doesn't normally have it.
      console.error('[portal layout] partner_contracts failed', error);
    }
    hasContracts = (data || []).length > 0;
  }

  return (
    <div className="min-h-screen">
      <PortalNav contactType={partner?.contact_type} hasContracts={hasContracts} />
      {children}
    </div>
  );
}
