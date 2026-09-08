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
export const dynamic = 'force-dynamic';

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
    <main style={{ maxWidth: 720, margin: '32px auto', padding: '0 20px' }}>
      <h1>Your Wallet</h1>
      <MemberIdCard tokenRaw={memberTokenRaw} isActive={memberIsActive} />
      <WalletClient walletEnabled={isMemberWalletEnabled()} />
    </main>
  );
}
