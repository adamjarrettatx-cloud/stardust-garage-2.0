import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  generateMemberIdentityToken,
  hashMemberIdentityToken,
} from '@/lib/member-identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// /member/id \u2014 signed-in entry point that always resolves to the member's
// own /member/id/<token> full-screen badge.
//
// Model:
//   * Every member has exactly one identity token stored in
//     member_identity_tokens (both raw + hash, service-role readable only).
//   * Approving a member auto-issues one. This landing recovers it from the
//     DB and 302s to the tokenized page.
//   * If a member somehow reaches this page without a token row (approved
//     pre-backfill AND the backfill script never ran), we mint one on the
//     fly. Idempotent \u2014 the unique constraint on member_profile_id catches
//     a race with the backfill script or a concurrent tab.
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

  const { data: existing } = await admin
    .from('member_identity_tokens')
    .select('token_raw, revoked_at')
    .eq('member_profile_id', member.id)
    .maybeSingle();

  // Happy path: token exists and is live.
  if (existing?.token_raw && !existing.revoked_at) {
    redirect(`/member/id/${existing.token_raw}`);
  }

  // Missing (backfill gap) or revoked \u2014 rotate/issue a fresh one. For the
  // revoked case, upsert overwrites (member_profile_id is unique) and the
  // hash+raw change together.
  const raw = generateMemberIdentityToken();
  const hash = hashMemberIdentityToken(raw);
  const { error } = await admin
    .from('member_identity_tokens')
    .upsert(
      {
        member_profile_id: member.id,
        token_hash: hash,
        token_raw: raw,
        rotated_at: existing ? new Date().toISOString() : null,
        revoked_at: null,
        revoke_reason: null,
      },
      { onConflict: 'member_profile_id' },
    );

  if (error) {
    console.error('[member-id.mint]', error.message);
    // Absolute last resort: send them somewhere useful. The wallet page
    // will render a \"Member ID unavailable \u2014 contact staff\" card if the
    // token is missing.
    redirect('/member/wallet');
  }

  redirect(`/member/id/${raw}`);
}
