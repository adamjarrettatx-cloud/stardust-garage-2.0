import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/auth-helpers';

// POST /api/admin/cancel-subscription
// Body: { memberId: uuid }
//
// Admin endpoint to cancel a member's Stripe subscription at the end
// of their current billing period. The member retains access until then.
export async function POST(request) {
  try {
    const { unauthorized } = await requireAdmin();
    if (unauthorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { memberId } = await request.json();
    if (!memberId) {
      return NextResponse.json({ error: 'Missing memberId' }, { status: 400 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: member, error: fetchError } = await supabaseAdmin
      .from('member_profiles')
      .select('*')
      .eq('id', memberId)
      .single();

    if (fetchError || !member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    if (!member.stripe_subscription_id) {
      return NextResponse.json({ error: 'Member has no active subscription' }, { status: 400 });
    }

    // Tell Stripe to cancel at period end
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    const updateRes = await fetch(
      `https://api.stripe.com/v1/subscriptions/${member.stripe_subscription_id}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${stripeKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          cancel_at_period_end: 'true',
        }),
      }
    );

    if (!updateRes.ok) {
      const errorBody = await updateRes.text();
      console.error('Stripe cancel failed:', errorBody);
      return NextResponse.json(
        { error: 'Failed to cancel subscription with Stripe' },
        { status: 500 }
      );
    }

    // Optimistically update our database (the webhook will also fire and confirm this)
    await supabaseAdmin
      .from('member_profiles')
      .update({ cancel_at_period_end: true })
      .eq('id', memberId);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Cancel subscription route error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
