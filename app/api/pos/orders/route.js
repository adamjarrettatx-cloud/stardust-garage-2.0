import { NextResponse } from 'next/server';
import { requireTeam } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  calcCart,
  validateTenderForCart,
  formatOrderNumber,
  isValidTender,
} from '@/lib/pos-helpers';
import { getPaymentAdapter, isPhase1Tender, PaymentError } from '@/lib/pos-payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;

// GET /api/pos/orders — recent orders list (team-readable).
export async function GET(request) {
  const { unauthorized } = await requireTeam();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('pos_orders')
    .select('*, pos_order_items(*), pos_payments(*)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return NextResponse.json({ error: 'Failed to load orders' }, { status: 500 });
  return NextResponse.json({ orders: data || [] });
}

// POST /api/pos/orders — create a paid order in one shot (register checkout).
//
// Body: {
//   terminal_id?, cash_session_id?, notes?, discount_cents?,
//   items: [{ product_id?, name, sku?, price_cents, quantity, taxable?,
//             tax_rate_bps?, restricted_tender_policy? }],
//   tender: { type, processor_key?, reference?, amount_cents? }
// }
//
// SECURITY / CORRECTNESS:
//   * Totals are recomputed server-side from the submitted line inputs; the
//     client's totals are ignored.
//   * Restricted-tender rules are re-validated server-side — the UI disabling a
//     button is a convenience, not the enforcement point.
//   * Phase 1 only accepts tenders that move no money through a live processor.
export async function POST(request) {
  const { user, unauthorized } = await requireTeam();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Bad body' }, { status: 400 }); }

  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return NextResponse.json({ error: 'Cart is empty.' }, { status: 400 });

  const tender = body.tender || {};
  const tenderType = String(tender.type || '');
  if (!isValidTender(tenderType)) {
    return NextResponse.json({ error: 'Invalid tender type.' }, { status: 400 });
  }
  if (!isPhase1Tender(tenderType)) {
    return NextResponse.json({
      error: 'Live card/ACH processing is not available in Phase 1. Use cash or manual external card.',
    }, { status: 422 });
  }

  // Re-validate restricted-tender compliance server-side.
  const tenderCheck = validateTenderForCart(items, tenderType);
  if (!tenderCheck.allowed) {
    return NextResponse.json({ error: tenderCheck.reason, code: 'restricted_tender' }, { status: 422 });
  }

  // Recompute all money server-side.
  const totals = calcCart(items, body.discount_cents);

  const terminalId = typeof body.terminal_id === 'string' && UUID.test(body.terminal_id) ? body.terminal_id : null;
  const cashSessionId = typeof body.cash_session_id === 'string' && UUID.test(body.cash_session_id) ? body.cash_session_id : null;

  // Capture the payment via the adapter (no network in Phase 1).
  let capture;
  try {
    const adapter = getPaymentAdapter(tenderType, tender.processor_key || null);
    capture = await adapter.capture({
      amount_cents: totals.total_cents,
      reference: tender.reference || null,
      metadata: {},
    });
  } catch (err) {
    const msg = err instanceof PaymentError ? err.message : 'Payment failed.';
    return NextResponse.json({ error: msg }, { status: 422 });
  }

  const admin = createAdminClient();

  // Allocate a sequential order number. Count existing rows + 1; the unique
  // index on order_number guards against the rare race (retry on conflict).
  const { count } = await admin.from('pos_orders').select('*', { count: 'exact', head: true });
  const orderNumber = formatOrderNumber((count || 0) + 1);

  // 1. Insert the order.
  const { data: order, error: orderErr } = await admin
    .from('pos_orders')
    .insert({
      order_number: orderNumber,
      terminal_id: terminalId,
      cash_session_id: cashSessionId,
      cashier_id: user.id,
      status: 'paid',
      subtotal_cents: totals.subtotal_cents,
      tax_cents: totals.tax_cents,
      discount_cents: totals.discount_cents,
      total_cents: totals.total_cents,
      restricted_items_present: totals.restricted_items_present,
      notes: typeof body.notes === 'string' ? body.notes.trim() || null : null,
    })
    .select()
    .single();

  if (orderErr) {
    console.error('[pos.orders.create] order insert', orderErr);
    return NextResponse.json({ error: 'Failed to create order.' }, { status: 500 });
  }

  // 2. Insert line items (snapshot name/sku/policy).
  const itemRows = totals.lines.map((line, i) => {
    const src = items[i] || {};
    return {
      order_id: order.id,
      product_id: typeof src.product_id === 'string' && UUID.test(src.product_id) ? src.product_id : null,
      name_snapshot: String(src.name || src.name_snapshot || 'Item').slice(0, 200),
      sku_snapshot: src.sku ? String(src.sku).slice(0, 100) : null,
      quantity: line.quantity,
      unit_price_cents: line.unit_price_cents,
      tax_cents: line.tax_cents,
      line_total_cents: line.line_total_cents,
      restricted_tender_policy: line.restricted_tender_policy,
    };
  });
  const { error: itemsErr } = await admin.from('pos_order_items').insert(itemRows);
  if (itemsErr) {
    console.error('[pos.orders.create] items insert', itemsErr);
    await admin.from('pos_orders').delete().eq('id', order.id);
    return NextResponse.json({ error: 'Failed to record line items.' }, { status: 500 });
  }

  // 3. Record the payment.
  const { data: payment, error: payErr } = await admin
    .from('pos_payments')
    .insert({
      order_id: order.id,
      tender_type: tenderType,
      processor_key: capture.processor_key,
      status: capture.status,
      amount_cents: capture.amount_cents,
      processor_transaction_id: capture.processor_transaction_id,
      metadata: capture.metadata || {},
    })
    .select()
    .single();
  if (payErr) {
    console.error('[pos.orders.create] payment insert', payErr);
    await admin.from('pos_order_items').delete().eq('order_id', order.id);
    await admin.from('pos_orders').delete().eq('id', order.id);
    return NextResponse.json({ error: 'Failed to record payment.' }, { status: 500 });
  }

  return NextResponse.json({ order, payment, order_number: orderNumber });
}
