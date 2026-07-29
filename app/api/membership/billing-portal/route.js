import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getRequestUser } from '@/lib/auth-helpers';
import { resolveSiteUrl } from '@/lib/site-url';

// POST /api/membership/billing-portal
// Body: none.
//
// Returns `{ url }` — a short-lived Stripe Billing Portal link where the member
// can update their card, switch plan, or cancel. Stripe hosts the page, so the
// mobile app opens the URL in an in-app browser and never renders card fields
// natively. Cancellations made there come back to us as
// customer.subscription.updated/deleted and are applied by /api/stripe/webhook,
// so member_profiles stays in sync without any extra work here.
//
// SECURITY: the Stripe customer is always read from the AUTHENTICATED caller's
// own member_profiles row. A client-supplied customer id is never accepted —
// that would let any member open another member's billing portal.
export async function POST(request) {
  try {
    const user = await getRequestUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.json({ error: 'Stripe is not configured' }, { status: 500 });
    }

    const supabaseAdmin = createAdminClient();
    const { data: profile } = await supabaseAdmin
      .from('member_profiles')
      .select('id, stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle();

    // Never subscribed (or subscribed outside Stripe) — there is nothing to
    // manage. The client shows "no active membership to manage" and points at
    // the signup flow instead.
    if (!profile?.stripe_customer_id) {
      return NextResponse.json({ error: 'no_stripe_customer' }, { status: 400 });
    }

    // Same convention as /api/stripe/checkout. The deployment's own hostname
    // comes first, which is what keeps the mobile app — which sends no Origin
    // header at all — resolving to the right host rather than to the fallback.
    const origin = resolveSiteUrl(request);

    const sessionRes = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        customer: profile.stripe_customer_id,
        return_url: `${origin}/member`,
      }),
    });

    if (!sessionRes.ok) {
      const errorBody = await sessionRes.text();
      console.error('Stripe billing portal session failed:', errorBody);
      return NextResponse.json(
        { error: 'Failed to open the billing portal' },
        { status: 500 }
      );
    }

    const session = await sessionRes.json();
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error('Billing portal route error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
