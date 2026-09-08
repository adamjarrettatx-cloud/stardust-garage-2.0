import { getCurrentUser } from '@/lib/auth-helpers';
import { redirect } from 'next/navigation';
import { isMemberWalletEnabled, isInternalTicketingEnabled } from '@/lib/feature-flags';
import { createAdminClient } from '@/lib/supabase/admin';
import MemberIdCard from './MemberIdCard';
import WalletClient from './WalletClient';

// /member/wallet — Member ID card + saved payment methods + purchase history.
// Server component: gates on auth + feature flag, then resolves the current
// member's identity token (if any) so the card at the top can render inline
// without a client-side fetch.
//
// Visual language mirrors /account/tickets and /tickets/status: the shell
// hero uses the site's serif display face (Cormorant Garamond), a champagne
// overline, and muted subtitle — every child card renders as a variant of
// the same design system (see WalletClient.jsx for the shared tokens).
export const dynamic = 'force-dynamic';

const SERIF = "'Cormorant Garamond', 'Cormorant Unicase', 'Moshra Aesthetic', serif";
const SANS = "'Plus Jakarta Sans', 'Inter', system-ui, -apple-system, sans-serif";
const GOLD = '#d9c48c';
const MUTED = '#8a8a8a';

export default async function WalletPage() {
  if (!isInternalTicketingEnabled()) redirect('/member');
  const { user } = await getCurrentUser();
  if (!user) redirect('/login?next=/member/wallet');

  // Best-effort lookup of the current member's identity token. This block is
  // deliberately non-fatal: a non-member (a ticket-buyer who is signed in but
  // has no member_profiles row) still gets to see their tickets and cards,
  // just no Member ID card. Same for a member whose token issuance failed —
  // the card degrades to "tap to open your badge" and /member/id will mint
  // one on the fly.
  let memberTokenRaw = null;
  let memberIsActive = false;
  try {
    const admin = createAdminClient();
    const { data: member } = await admin
      .from('member_profiles')
      .select('id, is_active')
      .eq('user_id', user.id)
      .maybeSingle();
    if (member?.id) {
      memberIsActive = Boolean(member.is_active);
      const { data: token } = await admin
        .from('member_identity_tokens')
        .select('token_raw, revoked_at')
        .eq('member_profile_id', member.id)
        .maybeSingle();
      if (token?.token_raw && !token.revoked_at) {
        memberTokenRaw = token.token_raw;
      }
    }
  } catch (err) {
    console.error('[wallet.member-id]', err?.message || err);
  }

  return (
    <main
      style={{
        maxWidth: 880,
        margin: '0 auto',
        padding: '40px 20px 80px',
        color: '#f5f5f5',
        fontFamily: SANS,
      }}
    >
      {/* Hero — matches the overline + serif display pattern used on
          /account/tickets and /tickets/status. Kept in the server component
          so it never flashes an unstyled default heading on slow phones. */}
      <header style={{ marginBottom: 28 }}>
        <div
          style={{
            fontSize: 11,
            letterSpacing: '0.28em',
            color: GOLD,
            fontWeight: 600,
            textTransform: 'uppercase',
            marginBottom: 10,
          }}
        >
          Stardust Garage
        </div>
        <h1
          style={{
            margin: 0,
            fontFamily: SERIF,
            fontWeight: 500,
            fontSize: 'clamp(36px, 6vw, 52px)',
            letterSpacing: '-0.01em',
            lineHeight: 1.05,
          }}
        >
          Your Wallet
        </h1>
        <p
          style={{
            margin: '10px 0 0',
            color: MUTED,
            fontSize: 15,
            maxWidth: 560,
            lineHeight: 1.55,
          }}
        >
          Your member badge, saved cards, and every ticket you've picked up. Everything you need at the door lives here.
        </p>
      </header>

      <MemberIdCard tokenRaw={memberTokenRaw} isActive={memberIsActive} />
      <WalletClient walletEnabled={isMemberWalletEnabled()} />
    </main>
  );
}
