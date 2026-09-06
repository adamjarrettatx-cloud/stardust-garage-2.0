import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getRequestUser } from '@/lib/auth-helpers';
import { resolveSiteUrl } from '@/lib/site-url';
import { isMemberWalletEnabled } from '@/lib/feature-flags';
import { rateLimit, keyFromRequest } from '@/lib/rate-limit';
import { createSavePaymentMethodSession } from '@/lib/tickets/stripe';

// POST /api/wallet/setup
// Body: {} (nothing required — the caller is identified by session)
//
// Starts a Stripe Checkout Session in `setup` mode so the buyer can add a
// card to their Stripe customer without a purchase. On success the webhook
// (checkout.session.completed with checkout_kind=save_payment_method) writes
// the saved_payment_method_refs row. NEVER touches PAN/CVC ourselves.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  if (!isMemberWalletEnabled()) {
    return NextResponse.json({ error: 'Wallet disabled' }, { status: 404 });
  }
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = rateLimit({ key: `wallet_setup:${user.id}`, limit: 5, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json({ error: 'Too many requests' }, {
      status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) },
    });
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  const { data: profile } = await supabaseAdmin
    .from('member_profiles')
    .select('id, email, full_name, stripe_customer_id')
    .eq('user_id', user.id)
    .maybeSingle();

  const origin = resolveSiteUrl(request);

  let result;
  try {
    result = await createSavePaymentMethodSession({
      userId: user.id,
      memberProfileId: profile?.id || null,
      email: user.email || profile?.email,
      fullName: profile?.full_name,
      existingCustomerId: profile?.stripe_customer_id || null,
      successUrl: `${origin}/member/wallet?saved=1`,
      cancelUrl: `${origin}/member/wallet?cancelled=1`,
    });
  } catch (err) {
    console.error('wallet setup failed:', err);
    return NextResponse.json({ error: 'Could not start card setup' }, { status: 502 });
  }

  // Persist the customer id so ticket flows reuse it.
  if (profile && result.customerId && profile.stripe_customer_id !== result.customerId) {
    await supabaseAdmin
      .from('member_profiles')
      .update({ stripe_customer_id: result.customerId })
      .eq('id', profile.id);
  }

  return NextResponse.json({ url: result.session.url });
}
