import ActivateClient from './ActivateClient';

export const revalidate = 0;

// Landing page for the magic link in the partner invite email. Deliberately not
// gated server-side (see the /portal/activate carve-out in middleware.js): the
// link carries a single-use ?token_hash=, so the session only exists once the
// browser client has redeemed it. ActivateClient does that, then verifies there
// is a partner_profiles row behind the session.
export default function PartnerActivatePage() {
  return <ActivateClient />;
}
