import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getRequestUser } from '@/lib/auth-helpers';
import { STRIPE_PRICES } from '@/lib/stripe-prices';

// POST /api/stripe/checkout
// Body: { plan: 'cowork' | 'iykyk', period: 'monthly' | 'quarterly' | 'annual' }
//
// Creates a Stripe Checkout session for the logged-in member and returns
// the checkout URL for the client to redirect to.
export async function POST(request) {
  try {
    // Verify the caller is logged in — session cookie (website) or
    // `Authorization: Bearer <access token>` (mobile app).
    const user = await getRequestUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { plan, period } = await request.json();
    if (!plan || !period) {
      return NextResponse.json({ error: 'Missing plan or period' }, { status: 400 });
    }

    const priceConfig = STRIPE_PRICES[plan]?.[period];
    if (!priceConfig) {
      return NextResponse.json({ error: 'Invalid plan/period combination' }, { status: 400 });
    }

    // Get the member profile to find or create Stripe customer
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: profile } = await supabaseAdmin
      .from('member_profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!profile) {
      return NextResponse.json(
        { error: 'Member profile not found. Contact hello@sdgatx.com.' },
        { status: 404 }
      );
    }

    // Block re-checkout if they already have an active subscription
    if (profile.subscription_status === 'active') {
      return NextResponse.json(
        { error: 'You already have an active membership.' },
        { status: 400 }
      );
    }

    // Create or reuse Stripe customer
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.json({ error: 'Stripe is not configured' }, { status: 500 });
    }

    let customerId = profile.stripe_customer_id;

    if (!customerId) {
      // Create a new Stripe customer for this member
      const customerRes = await fetch('https://api.stripe.com/v1/customers', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${stripeKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          email: profile.email,
          name: profile.full_name || '',
          'metadata[supabase_user_id]': user.id,
          'metadata[member_profile_id]': profile.id,
        }),
      });

      if (!customerRes.ok) {
        const errorBody = await customerRes.text();
        console.error('Stripe customer create failed:', errorBody);
        return NextResponse.json(
          { error: 'Failed to set up payment account' },
          { status: 500 }
        );
      }

      const customer = await customerRes.json();
      customerId = customer.id;

      // Save the customer ID immediately so we don't create duplicates on retry
      await supabaseAdmin
        .from('member_profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', profile.id);
    }

    // Create Stripe Checkout session for the subscription
    const origin = request.headers.get('origin') || 'https://sdgatx.com';

    const sessionRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        mode: 'subscription',
        customer: customerId,
        'line_items[0][price]': priceConfig.id,
        'line_items[0][quantity]': '1',
        success_url: `${origin}/member?activated=true`,
        cancel_url: `${origin}/member/activate?cancelled=true`,
        'subscription_data[metadata][plan]': plan,
        'subscription_data[metadata][period]': period,
        'subscription_data[metadata][supabase_user_id]': user.id,
        'subscription_data[metadata][member_profile_id]': profile.id,
        'metadata[plan]': plan,
        'metadata[period]': period,
        'metadata[supabase_user_id]': user.id,
      }),
    });

    if (!sessionRes.ok) {
      const errorBody = await sessionRes.text();
      console.error('Stripe checkout session failed:', errorBody);
      return NextResponse.json(
        { error: 'Failed to create checkout session' },
        { status: 500 }
      );
    }

    const session = await sessionRes.json();
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout route error:', err);
    return NextResponse.json(
      { error: 'Server error: ' + (err?.message || 'unknown') },
      { status: 500 }
    );
  }
}
