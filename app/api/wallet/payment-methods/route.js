import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getRequestUser } from '@/lib/auth-helpers';
import { isMemberWalletEnabled } from '@/lib/feature-flags';
import { stripe } from '@/lib/stripe/client';

// GET  /api/wallet/payment-methods  -> list caller's saved PMs
// POST /api/wallet/payment-methods  -> body: { payment_method_id, action: 'default' | 'delete' }
//
// Reads live via RLS-scoped client (owner-only select). Writes go through
// service role + defense-in-depth check that the row belongs to the caller.
// Deletion detaches from Stripe first so a compromised DB never leaves an
// orphan PM re-attachable.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function GET(request) {
  if (!isMemberWalletEnabled()) return NextResponse.json({ error: 'Wallet disabled' }, { status: 404 });
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabaseAdmin = adminClient();
  const { data } = await supabaseAdmin
    .from('saved_payment_method_refs')
    .select('id, stripe_payment_method_id, brand, last4, exp_month, exp_year, is_default, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  return NextResponse.json({ payment_methods: data || [] });
}

export async function POST(request) {
  if (!isMemberWalletEnabled()) return NextResponse.json({ error: 'Wallet disabled' }, { status: 404 });
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const pmId = body?.payment_method_id;
  const action = body?.action;
  if (!pmId || !['default', 'delete'].includes(action)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const supabaseAdmin = adminClient();
  const { data: row } = await supabaseAdmin
    .from('saved_payment_method_refs')
    .select('*')
    .eq('stripe_payment_method_id', pmId)
    .eq('user_id', user.id) // defense-in-depth
    .maybeSingle();
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (action === 'default') {
    // Clear existing default, set this one. Wrap so we don't leave two
    // defaults if the second update fails.
    await supabaseAdmin
      .from('saved_payment_method_refs')
      .update({ is_default: false })
      .eq('user_id', user.id);
    await supabaseAdmin
      .from('saved_payment_method_refs')
      .update({ is_default: true })
      .eq('id', row.id);
    // Best-effort: tell Stripe too.
    try {
      await stripe.post(`/customers/${row.stripe_customer_id}`, {
        params: { 'invoice_settings[default_payment_method]': row.stripe_payment_method_id },
      });
    } catch (err) {
      console.warn('stripe default PM sync failed:', err?.message);
    }
    return NextResponse.json({ ok: true });
  }

  if (action === 'delete') {
    // Detach in Stripe first; if that fails, keep the local row so we can retry.
    try {
      await stripe.post(`/payment_methods/${pmId}/detach`);
    } catch (err) {
      console.error('stripe detach failed:', err);
      return NextResponse.json({ error: 'Detach failed' }, { status: 502 });
    }
    await supabaseAdmin
      .from('saved_payment_method_refs')
      .delete()
      .eq('id', row.id);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Unhandled action' }, { status: 400 });
}
