import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildPasswordResetUrl, normalizeInviteEmail } from '@/lib/partner-identity';
import { resolveSiteUrl } from '@/lib/site-url';
import { sendPasswordReset } from '@/lib/email';

export const runtime = 'nodejs';

// POST /api/auth/request-password-reset
// Body: { email: string }
//
// Replaces a direct call to supabase.auth.resetPasswordForEmail(). That
// method mails Supabase's own action_link, which points at
// <project>.supabase.co/auth/v1/verify before it ever redirects back to us —
// a supabase.co URL in the recipient's inbox, and exactly the kind of
// provider-branded link this route exists to avoid.
//
// Same shape as /api/partner/request-signin-link: we still generate the
// token with generateLink() and still deliver through Resend, we just mint
// our own /reset-password?token_hash=... link (see buildPasswordResetUrl)
// and redeem it ourselves via verifyOtp on the client.
//
// Public by necessity — the caller is logged out, that's the point. Every
// branch below returns the same { ok: true } so this can't be used to
// enumerate registered emails.
export async function POST(request) {
  const genericOk = NextResponse.json({ ok: true });

  try {
    const body = await request.json().catch(() => null);
    const email = normalizeInviteEmail(body?.email);
    if (!email) return genericOk;

    const admin = createAdminClient();

    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email,
    });

    // No account with this email (or any other generateLink failure): say
    // nothing and return the same response as success.
    if (linkErr || !link?.properties?.hashed_token) {
      if (linkErr && linkErr.status !== 400 && linkErr.code !== 'user_not_found') {
        console.error('[request-password-reset] could not generate link', linkErr);
      }
      return genericOk;
    }

    await sendPasswordReset({
      email,
      resetUrl: buildPasswordResetUrl(resolveSiteUrl(request), link.properties.hashed_token),
    });

    return genericOk;
  } catch (err) {
    // Including a Resend outage: the user is told to check their mail either
    // way, because saying more would leak whether the address is registered.
    console.error('[request-password-reset] failed', err);
    return genericOk;
  }
}
