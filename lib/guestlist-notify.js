// Server-only side of the guest list grant notification: reads who the partner
// is, decides whether they should be mailed at all, and sends it best-effort.
//
// Deliberately NOT in lib/guestlist-helpers.js, which the admin panel imports
// into the browser — pulling lib/email.js in there would ship the Resend call
// to the client. The pure rules (resolveGrantNotification, grantSlotsIncreased)
// stay in the helpers so the client and the tests can read them.

import { resolveGrantNotification } from '@/lib/guestlist-helpers';
import { resolveSiteUrl } from '@/lib/site-url';
import { formatDateDisplay } from '@/lib/studio-helpers';
import { sendGuestlistGrant } from '@/lib/email';

// Emails the partner that they have guest list room for this event. Never
// throws and never signals failure upward as an exception: the grant row is the
// source of truth and is already written by the time we get here, so a Resend
// outage must not roll it back. The caller passes the outcome to the admin UI.
//
// Returns { sent, reason, error }:
//   sent   — the email went out
//   reason — why it deliberately didn't (see resolveGrantNotification), or
//            'send_failed' when Resend rejected it
export async function notifyGrantPartner({ admin, request, eventId, contactId, slots, isUpdate = false }) {
  try {
    const [{ data: contact }, { data: partner }, { data: event }] = await Promise.all([
      admin
        .from('contacts')
        .select('display_name, primary_contact_name, email')
        .eq('id', contactId)
        .maybeSingle(),
      admin
        .from('partner_profiles')
        .select('full_name, is_active')
        .eq('contact_id', contactId)
        .maybeSingle(),
      admin.from('events').select('title, event_date').eq('id', eventId).maybeSingle(),
    ]);

    const { send, reason, email } = resolveGrantNotification({ contact, partner, slots });
    if (!send) return { sent: false, reason, error: null };

    await sendGuestlistGrant({
      email,
      fullName: partner?.full_name || contact?.primary_contact_name || contact?.display_name,
      eventTitle: event?.title || 'a Stardust Garage event',
      eventDate: event?.event_date ? formatDateDisplay(event.event_date) : null,
      freeSlots: slots.free_slots,
      discountSlots: slots.discount_slots,
      discountDetail: slots.discount_detail,
      guestListUrl: `${resolveSiteUrl(request)}/partner/guest-list`,
      isUpdate,
    });

    return { sent: true, reason: null, error: null };
  } catch (err) {
    console.error('[guestlist.notify] grant email failed', err);
    return { sent: false, reason: 'send_failed', error: err?.message || String(err) };
  }
}
