import { NextResponse } from 'next/server';
import {
  sendInternalNotification,
} from '@/lib/email';
import { keyFromRequest, rateLimit } from '@/lib/rate-limit';

// POST /api/notify
// Body: { formType: string, data: object }
//
// formType — one of: 'signup', 'membership_application',
//   'venue_inquiry', 'micro_party_inquiry', 'collaboration'
// data — the form data (used in the internal notification email)
// This endpoint only sends the internal notification to the fixed admin inbox
// in lib/email.js. It never sends to a caller-controlled email address.
const ALLOWED_FORM_TYPES = new Set([
  'signup',
  'membership_application',
  'venue_inquiry',
  'micro_party_inquiry',
  'collaboration',
]);

export async function POST(request) {
  const limit = rateLimit({
    key: keyFromRequest(request, 'notify'),
    limit: 5,
    windowMs: 60 * 1000,
  });
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  try {
    const { formType, data } = await request.json();

    if (!ALLOWED_FORM_TYPES.has(formType)) {
      return NextResponse.json({ error: 'Invalid formType' }, { status: 400 });
    }

    const results = await Promise.allSettled([sendInternalNotification({
      formType,
      data: data && typeof data === 'object' && !Array.isArray(data) ? data : {},
    })]);

    // Log failures but don't fail the request — the form submission
    // already saved to Supabase. Email failures are a soft error.
    results.forEach((r) => {
      if (r.status === 'rejected') {
        console.error('Email send failed (internal notification):', r.reason?.message || r.reason);
      }
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Notify route error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
