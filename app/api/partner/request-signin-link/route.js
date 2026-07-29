import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  buildPartnerActivationUrl,
  findPartnerByInvitedEmail,
  normalizeInviteEmail,
} from '@/lib/partner-identity';
import { resolveSiteUrl } from '@/lib/site-url';
import { sendPartnerInvite } from '@/lib/email';

export const runtime = 'nodejs';

// POST /api/partner/request-signin-link
// Body: { email: string }
//
// The backup door, for partners whose invited address isn't a Google account or
// whose original invite link has expired. Same credential as the invite —
// a single-use Supabase magic link, generated with the service-role key and
// delivered through Resend — so this is the existing invite path re-triggered
// by the partner instead of by an admin.
//
// Public by necessity: the caller is logged out, that's the point. Two things
// keep that safe:
//   * it only ever mails an address that ALREADY has a partner_profiles row, so
//     it cannot be used to send mail to arbitrary people;
//   * the response is identical whether or not the address is a partner, so it
//     cannot be used to enumerate who we work with. Every failure below returns
//     the same { ok: true }.
export async function POST(request) {
  const genericOk = NextResponse.json({ ok: true });

  try {
    const body = await request.json().catch(() => null);
    const email = normalizeInviteEmail(body?.email);
    if (!email) return genericOk;

    const admin = createAdminClient();
    const profile = await findPartnerByInvitedEmail(admin, email);
    if (!profile) return genericOk;

    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    });

    if (linkErr || !link?.properties?.hashed_token) {
      console.error('[request-signin-link] could not generate link', linkErr);
      return genericOk;
    }

    await sendPartnerInvite({
      email,
      fullName: profile.full_name,
      contactType: null,
      // /partner/activate handles both states: it sends an already-activated
      // partner straight on to their profile.
      activationUrl: buildPartnerActivationUrl(
        resolveSiteUrl(request),
        link.properties.hashed_token
      ),
    });

    return genericOk;
  } catch (err) {
    // Including a Resend outage: the partner is told to check their mail either
    // way, because saying more would leak whether the address is a partner.
    console.error('[request-signin-link] failed', err);
    return genericOk;
  }
}
