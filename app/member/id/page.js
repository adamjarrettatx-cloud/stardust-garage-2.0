import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  generateMemberIdentityToken,
  hashMemberIdentityToken,
} from '@/lib/member-identity';
import { getOrIssueMemberIdentityToken } from '@/lib/member-identity-token-service.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// /member/id \u2014 signed-in entry point that always resolves to the member's
// own /member/id/<token> full-screen badge.
//
// Model:
//   * The database persists only a SHA-256 hash; raw credentials are returned
//     once to this signed-in navigation and are never recoverable from the DB.
//   * Each visit mints a replacement and revokes the prior live credential.
//
// The raw token is copied into a redirect URL, so it hits the browser's
// address bar and history \u2014 same posture as /pass/<token> URLs for trial
// passes. That is the intended threat model: photo verification at the door
// is what actually gates entry, so a photographed/leaked QR gets caught.
export default async function MemberIdIndexPage() {
  const { user } = await getCurrentUser();
  if (!user) redirect('/login?next=/member/id');

  const admin = createAdminClient();

  const { data: member } = await admin
    .from('member_profiles')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle();

  // Not a member \u2014 send them to the general signed-in landing.
  if (!member?.id) redirect('/member/wallet');

  // Raw badge credentials are never persisted. Minting here returns the raw
  // value once in this redirect while the database retains only its hash.
  const result = await getOrIssueMemberIdentityToken({
    admin,
    userId: user.id,
    requireActive: false,
    mintToken: () => {
      const raw = generateMemberIdentityToken();
      return { raw, hash: hashMemberIdentityToken(raw) };
    },
  });

  if (result.kind !== 'ok') {
    if (result.kind === 'error') console.error('[member-id.mint]', result.error?.message || result.error);
    redirect('/member/wallet');
  }

  redirect(`/member/id/${result.token}`);
}
