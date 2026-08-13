// Server-only side of the Phase 3 pay-request notifications: reads who needs
// to hear about a request/approve/reject, and sends best-effort email + push.
//
// Deliberately NOT in lib/pay-request-helpers.js, which the admin panel and
// partner portal import into the browser — pulling lib/email.js / lib/push.js
// in there would ship the Resend/push calls to the client. Mirrors
// lib/guestlist-notify.js's shape exactly: never throws, the row being
// notified about is already committed by the time we get here, so a Resend or
// push outage must never roll back a write that already happened.
//
// CRITICAL targeting note (found reading the deployed send-push edge function
// source this session): its `emails` param resolves ONLY against
// member_profiles, never team_members or partner_profiles. So both notify
// functions below target push via `userIds` — team_members.user_id for
// admins, partner_profiles.user_id for the artist — and never via `emails`.

import { formatMoney } from '@/lib/studio-helpers';
import { resolveSiteUrl } from '@/lib/site-url';
import { sendInternalNotification, sendArtistPayApproved, sendArtistPayRejected } from '@/lib/email';
import { sendPush } from '@/lib/push';

// Fired right after a partner successfully requests pay. Emails the shared
// admin inbox (same channel every other "something needs review" event uses)
// and pushes every admin with a registered device. Best-effort on both — a
// missed email/push does not undo the request; it still shows up in
// /bananas/pay-requests either way.
export async function notifyAdminsPayRequested({ admin, request, contactId, eventId, amountCents }) {
  try {
    const [{ data: contact }, { data: event }, { data: admins }] = await Promise.all([
      admin.from('contacts').select('display_name').eq('id', contactId).maybeSingle(),
      admin.from('events').select('title').eq('id', eventId).maybeSingle(),
      admin.from('team_members').select('user_id').eq('role', 'admin'),
    ]);

    const artistName = contact?.display_name || 'An artist';
    const eventTitle = event?.title || 'an event';
    const amountLabel = formatMoney(amountCents);

    await sendInternalNotification({
      formType: 'artist_pay_request',
      data: {
        artist: artistName,
        event: eventTitle,
        amount: amountLabel,
        review_url: `${resolveSiteUrl(request)}/bananas/pay-requests`,
      },
    }).catch((err) => console.error('[pay-request.notify] admin email failed', err));

    const userIds = (admins || []).map((a) => a.user_id).filter(Boolean);
    if (userIds.length) {
      await sendPush({
        title: 'Pay request',
        body: `${artistName} requested ${amountLabel} for ${eventTitle}.`,
        data: { type: 'artist_pay_requested' },
        userIds,
      });
    }

    return { sent: true, error: null };
  } catch (err) {
    console.error('[pay-request.notify] notifyAdminsPayRequested failed', err);
    return { sent: false, error: err?.message || String(err) };
  }
}

// Fired right after an admin approves or rejects a request. Emails + pushes
// the artist. `decision` is 'approved' | 'rejected'.
export async function notifyArtistPayReviewed({ admin, request, contactId, eventId, amountCents, decision, rejectionReason }) {
  try {
    const [{ data: contact }, { data: event }, { data: partner }] = await Promise.all([
      admin.from('contacts').select('display_name, email').eq('id', contactId).maybeSingle(),
      admin.from('events').select('title').eq('id', eventId).maybeSingle(),
      admin.from('partner_profiles').select('user_id, full_name, is_active').eq('contact_id', contactId).maybeSingle(),
    ]);

    // Same "don't email someone who can't act on it" guard the guest list
    // notifier uses: no active partner login, no email attempt.
    const email = contact?.email;
    if (!email || !partner?.is_active) {
      return { sent: false, reason: !email ? 'no_email' : 'inactive_partner', error: null };
    }

    const eventTitle = event?.title || 'your set';
    const amountLabel = formatMoney(amountCents);
    const fullName = partner?.full_name || contact?.display_name;
    const payUrl = `${resolveSiteUrl(request)}/partner/pay`;

    if (decision === 'approved') {
      await sendArtistPayApproved({ email, fullName, eventTitle, amountLabel, payUrl });
    } else {
      await sendArtistPayRejected({ email, fullName, eventTitle, amountLabel, rejectionReason, payUrl });
    }

    if (partner?.user_id) {
      await sendPush({
        title: decision === 'approved' ? 'Pay request approved' : 'Pay request update',
        body:
          decision === 'approved'
            ? `Your ${amountLabel} request for ${eventTitle} was approved.`
            : `Your ${amountLabel} request for ${eventTitle} needs another look.`,
        data: { type: `artist_pay_${decision}` },
        userIds: [partner.user_id],
      });
    }

    return { sent: true, error: null };
  } catch (err) {
    console.error('[pay-request.notify] notifyArtistPayReviewed failed', err);
    return { sent: false, error: err?.message || String(err) };
  }
}
