import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isMailchimpConfigured, lookupEmailByMcEid, lookupCampaignTitle } from '@/lib/mailchimp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/marketing/track-click — called client-side (see
// app/components/MailchimpAttribution.js) whenever someone lands on the site
// via a Mailchimp email link. Resolves the click to an email address and logs
// it, so a later Ticket Tailor order webhook can match a purchase back to the
// campaign that drove it.
//
// Deliberately low-stakes: always acks 200 (this is telemetry, not a
// transaction) and never throws on a missing/misconfigured Mailchimp setup —
// the click is still recorded (without an email) so click volume is visible
// even before Mailchimp env vars are configured.
export async function POST(request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ received: true, skipped: 'bad_json' });
  }

  const mcCid = typeof payload?.mc_cid === 'string' ? payload.mc_cid.slice(0, 200) : null;
  const mcEid = typeof payload?.mc_eid === 'string' ? payload.mc_eid.slice(0, 200) : null;
  const path = typeof payload?.path === 'string' ? payload.path.slice(0, 500) : '/';

  if (!mcCid && !mcEid) {
    return NextResponse.json({ received: true, skipped: 'no_tracking_ids' });
  }

  let email = null;
  let campaignTitle = null;
  if (isMailchimpConfigured()) {
    try {
      [email, campaignTitle] = await Promise.all([
        lookupEmailByMcEid(mcEid),
        lookupCampaignTitle(mcCid),
      ]);
    } catch (err) {
      console.warn('[marketing.track-click] Mailchimp lookup failed', err);
    }
  }

  try {
    const admin = createAdminClient();
    await admin.from('marketing_email_clicks').insert({
      email,
      mc_cid: mcCid,
      mc_eid: mcEid,
      campaign_title: campaignTitle,
      landing_path: path,
      user_agent: request.headers.get('user-agent')?.slice(0, 500) || null,
    });
  } catch (err) {
    console.warn('[marketing.track-click] failed to log click', err);
  }

  return NextResponse.json({ received: true });
}
