import { NextResponse } from 'next/server';
import {
  sendInternalNotification,
  sendUserConfirmation,
} from '@/lib/email';

// POST /api/notify
// Body: { formType: string, data: object, email?: string }
//
// formType — one of: 'signup', 'membership_application',
//   'venue_inquiry', 'micro_party_inquiry', 'collaboration'
// data — the form data (used in the internal notification email)
// email — the submitter's email (used to send them a confirmation)
//
// Sends both emails in parallel. Returns 200 even if one fails — we
// don't want a missed email to break the user's success state. Errors
// are logged for the team to inspect.
export async function POST(request) {
  try {
    const { formType, data, email } = await request.json();

    if (!formType) {
      return NextResponse.json({ error: 'Missing formType' }, { status: 400 });
    }

    const results = await Promise.allSettled([
      sendInternalNotification({ formType, data: data || {} }),
      email ? sendUserConfirmation({ formType, email }) : Promise.resolve(null),
    ]);

    // Log failures but don't fail the request — the form submission
    // already saved to Supabase. Email failures are a soft error.
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        const which = i === 0 ? 'internal notification' : 'user confirmation';
        console.error(`Email send failed (${which}):`, r.reason?.message || r.reason);
      }
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Notify route error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
