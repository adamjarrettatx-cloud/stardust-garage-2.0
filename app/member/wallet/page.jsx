import { getCurrentUser } from '@/lib/auth-helpers';
import { redirect } from 'next/navigation';
import { isMemberWalletEnabled, isInternalTicketingEnabled } from '@/lib/feature-flags';
import WalletClient from './WalletClient';

// /member/wallet — Saved payment methods + purchase history.
// Server component: gates on auth + feature flag before rendering.
export const dynamic = 'force-dynamic';

export default async function WalletPage() {
  if (!isInternalTicketingEnabled()) redirect('/member');
  const { user } = await getCurrentUser();
  if (!user) redirect('/login?next=/member/wallet');

  return (
    <main style={{ maxWidth: 720, margin: '32px auto', padding: '0 20px' }}>
      <h1>Your Wallet</h1>
      <WalletClient walletEnabled={isMemberWalletEnabled()} />
    </main>
  );
}
