import { notFound, redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentUser } from '@/lib/auth-helpers';
import { qrMatrixToSvg } from '@/lib/qr-code';
import { resolveSiteUrl } from '@/lib/site-url';
import { createProfilePhotoSignedUrl } from '@/lib/profile-photo';
import {
  buildMemberIdentityUrl,
  hashMemberIdentityToken,
  isWellFormedMemberIdentityToken,
} from '@/lib/member-identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Member ID · Stardust Garage',
  robots: { index: false, follow: false },
  other: { 'theme-color': '#0a0a0a' },
};

// /member/id/[token] — the member's own badge, as a web page.
//
// Same shape as /pass/[token] (the trial-pass badge). The token IS the
// credential: 256 bits of randomness, hashed at rest, handed only to the
// member. Whoever holds it CAN be previewed at the door — photo verification
// at the door is what actually gates entry.
//
// Two ways to arrive:
//
//   1. The member opens their own wallet card, which links here. In that
//      case they're signed in AND the token matches their profile — we
//      render the full badge (photo + name + tier + QR).
//
//   2. A door-scanned QR resolves here in the guest's own browser via a
//      cameraphone. Same page render, same content — because the token IS
//      the credential, the reader is by definition allowed to see it, and
//      the door scanner uses its own preview endpoint (not this page) to
//      make its check-in decision.
//
// If the token is malformed or unknown, we 404 rather than reveal whether
// a hash exists.
export default async function MemberIdPage({ params }) {
  const { token } = await params;

  if (!isWellFormedMemberIdentityToken(token)) notFound();

  const admin = createAdminClient();
  const tokenHash = hashMemberIdentityToken(token);

  const { data: tokenRow } = await admin
    .from('member_identity_tokens')
    .select('member_profile_id, revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (!tokenRow || tokenRow.revoked_at) notFound();

  const { data: member } = await admin
    .from('member_profiles')
    .select('id, full_name, email, profile_photo_path, photo_url, subscription_plan, subscription_status, is_active')
    .eq('id', tokenRow.member_profile_id)
    .maybeSingle();

  if (!member) notFound();

  // Extra guard: if a signed-in user hits this URL and they are NOT this
  // member, we still render (the token is a credential; if they have it,
  // they have it), but we do a soft privacy check for the common case of a
  // logged-in curious user typing/guessing a URL: only redirect them if
  // they're logged in AND the URL clearly isn't theirs, AND we can safely
  // point them at their own. Otherwise render.
  const { user } = await getCurrentUser();
  if (user && user.id) {
    const { data: viewer } = await admin
      .from('member_profiles')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (viewer?.id && viewer.id !== member.id) {
      redirect('/member/id');
    }
  }

  // Signed URL for the member's face photo (short TTL, private bucket).
  let photoSignedUrl = null;
  if (member.profile_photo_path) {
    try {
      const signed = await createProfilePhotoSignedUrl(admin, member.profile_photo_path);
      photoSignedUrl = signed?.signedUrl || null;
    } catch {
      photoSignedUrl = null;
    }
  }
  const photoSrc = photoSignedUrl || member.photo_url || null;

  const firstName = (member.full_name || '').trim().split(/\s+/)[0] || 'Member';
  const idUrl = buildMemberIdentityUrl(resolveSiteUrl(), token);
  const qrSvg = qrMatrixToSvg(idUrl, { size: 280, dark: '#0a0a0a', light: '#ffffff' });

  const tierLabel = formatTierLabel(member.subscription_plan);
  const statusLabel = member.is_active ? 'ACTIVE MEMBER' : 'INACTIVE';
  const statusColor = member.is_active ? '#d9c48c' : '#ff8686';

  return (
    <main className="min-h-screen flex items-center justify-center px-5 py-16" style={{ background: '#0a0a0a' }}>
      <div className="max-w-[420px] w-full mx-auto text-center">
        <div
          className="inline-flex items-center gap-2 text-[10px] font-semibold tracking-[0.18em] px-3.5 py-1.5 rounded-full mb-6"
          style={{ color: statusColor, border: `1px solid ${statusColor}44` }}
        >
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ background: statusColor }}
            aria-hidden="true"
          />
          {statusLabel}
        </div>

        <h1
          className="text-[28px] md:text-[34px] font-extrabold -tracking-[0.02em] leading-[1.15] mb-1"
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: '#ffffff' }}
        >
          {firstName}
        </h1>
        {tierLabel ? (
          <p
            className="text-[12px] font-semibold tracking-[0.16em] mb-7"
            style={{ color: '#d9c48c' }}
          >
            {tierLabel}
          </p>
        ) : (
          <div style={{ height: 28 }} aria-hidden="true" />
        )}

        {photoSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoSrc}
            alt=""
            className="w-24 h-24 rounded-full object-cover mx-auto mb-6"
            style={{ border: '2px solid rgba(255,255,255,0.12)' }}
          />
        ) : null}

        {qrSvg ? (
          <div
            className="inline-block rounded-2xl p-4"
            style={{ background: '#ffffff' }}
            aria-label="Member ID QR code"
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
        ) : null}

        <p className="text-[13px] leading-[1.6] mt-7" style={{ color: 'rgba(255,255,255,0.55)' }}>
          Show this code at the door. Staff scan it and your access is checked automatically.
        </p>
      </div>
    </main>
  );
}

function formatTierLabel(plan) {
  if (!plan) return null;
  const map = {
    founder: 'FOUNDER',
    creative: 'CREATIVE',
    resident: 'RESIDENT',
    guest: 'GUEST',
  };
  return map[String(plan).toLowerCase()] || String(plan).toUpperCase();
}
