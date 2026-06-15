import { NextResponse } from 'next/server';
import { requireTeam } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  calcCart,
  validateTenderForCart,
  buildCanonicalCartItems,
  formatOrderNumber,
  isValidTender,
  requiresAdminTender,
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
//   items: [{ product_id, quantity }],          // client sends IDs + qty ONLY
//   tender: { type, reference?, comp_reason? }
// }
//
// SECURITY / CORRECTNESS:
//   * The client may ONLY choose products (by id) and quantities, plus a tender
//     and an optional reference. Price, tax, name, sku, and restricted-tender
//     policy are ALWAYS loaded from the canonical pos_products rows server-side
//     — never trusted from the request. This is the restricted-tender
//     enforcement point: a tampered policy in the body cannot bypass it.
//   * Inactive / unknown products are rejected.
//   * `comp` is an admin-authorized free sale: a non-admin caller is rejected,
//     and a reason is required for the audit trail.
//   * Phase 1 only accepts tenders that move no money through a live processor.
//   * A cash tender must be tied to an OPEN cash session that belongs to the
//     terminal, so cash is reconcilable.
export async function POST(request) {
  const { user, isAdmin, unauthorized } = await requireTeam();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Bad body' }, { status: 400 }); }

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

  // Comp is an admin-only, reason-required free sale. An ordinary cashier can
  // never ring a free sale with one tap.
  let compReason = null;
  if (requiresAdminTender(tenderType)) {
    if (!isAdmin) {
      return NextResponse.json({
        error: 'Comp sales require an administrator.',
        code: 'comp_requires_admin',
      }, { status: 403 });
    }
    compReason = typeof tender.comp_reason === 'string' ? tender.comp_reason.trim() : '';
    if (!compReason) {
      return NextResponse.json({
        error: 'A reason is required to comp an order.',
        code: 'comp_reason_required',
      }, { status: 400 });
    }
    compReason = compReason.slice(0, 500);
  }

  const admin = createAdminClient();

  // Load CANONICAL product rows for the requested ids; build calc-ready line
  // inputs from the DB, ignoring any client-supplied price/tax/name/policy.
  const requested = Array.isArray(body.items) ? body.items : [];
  if (!requested.length) {
    return NextResponse.json({ error: 'Cart is empty.' }, { status: 400 });
  }
  if (!requested.every((r) => typeof r?.product_id === 'string' && UUID.test(r.product_id))) {
    return NextResponse.json({ error: 'Each cart item requires a valid product_id.' }, { status: 400 });
  }
  const requestedIds = [...new Set(requested.map((r) => r.product_id))];

  const { data: products, error: prodErr } = await admin
    .from('pos_products')
    .select('id, name, sku, price_cents, tax_rate_bps, taxable, active, restricted_tender_policy')
    .in('id', requestedIds);
  if (prodErr) {
    console.error('[pos.orders.create] product load', prodErr);
    return NextResponse.json({ error: 'Failed to load products.' }, { status: 500 });
  }

  const { items, error: buildErr } = buildCanonicalCartItems(requested, products);
  if (buildErr) return NextResponse.json({ error: buildErr }, { status: 400 });

  // Re-validate restricted-tender compliance against the CANONICAL policies.
  const tenderCheck = validateTenderForCart(items, tenderType);
  if (!tenderCheck.allowed) {
    return NextResponse.json({ error: tenderCheck.reason, code: 'restricted_tender' }, { status: 422 });
  }

  // Recompute all money server-side from canonical product data.
  const totals = calcCart(items, body.discount_cents);

  const terminalId = typeof body.terminal_id === 'string' && UUID.test(body.terminal_id) ? body.terminal_id : null;
  let cashSessionId = typeof body.cash_session_id === 'string' && UUID.test(body.cash_session_id) ? body.cash_session_id : null;

  // Cash sales must be reconcilable: require an OPEN session that belongs to the
  // terminal the sale was rung on. Non-cash tenders may omit a session.
  if (tenderType === 'cash') {
    if (!cashSessionId) {
      return NextResponse.json({
        error: 'Cash sales require an open cash session.',
        code: 'cash_session_required',
      }, { status: 400 });
    }
    const { data: session } = await admin
      .from('pos_cash_sessions')
      .select('id, status, terminal_id')
      .eq('id', cashSessionId)
      .maybeSingle();
    if (!session || session.status !== 'open') {
      return NextResponse.json({
        error: 'The cash session is not open.',
        code: 'cash_session_not_open',
      }, { status: 409 });
    }
    if (terminalId && session.terminal_id && session.terminal_id !== terminalId) {
      return NextResponse.json({
        error: 'The cash session does not belong to this terminal.',
        code: 'cash_session_terminal_mismatch',
      }, { status: 409 });
    }
  } else if (cashSessionId) {
    // A session id supplied with a non-cash tender is ignored to avoid
    // polluting reconciliation with non-cash totals.
    cashSessionId = null;
  }

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

  // Insert the order, retrying on the rare order_number unique collision. The
  // sequence-backed allocator makes collisions effectively impossible, but the
  // retry keeps us safe even if the sequence is unavailable and we fall back to
  // the timestamp-based number.
  let order = null;
  let orderErr = null;
  for (let attempt = 0; attempt < 5 && !order; attempt++) {
    const orderNumber = await nextOrderNumber(admin);
    const res = await admin
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
        comp_reason: compReason,
      })
      .select()
      .single();
    if (!res.error) { order = res.data; break; }
    // 23505 = unique violation (order_number). Retry with a fresh number.
    if (res.error.code === '23505') { orderErr = res.error; continue; }
    orderErr = res.error;
    break;
  }

  if (!order) {
    console.error('[pos.orders.create] order insert', orderErr);
    return NextResponse.json({ error: 'Failed to create order.' }, { status: 500 });
  }

  // Insert line items (snapshot canonical name/sku/policy).
  const itemRows = totals.lines.map((line, i) => {
    const src = items[i] || {};
    return {
      order_id: order.id,
      product_id: src.product_id || null,
      name_snapshot: String(src.name || 'Item').slice(0, 200),
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

  // Record the payment.
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

  return NextResponse.json({ order, payment, order_number: order.order_number });
}

// Allocate the next order number using the DB sequence (atomic, race-free). If
// the RPC is unavailable (e.g. migration not yet applied), fall back to a
// timestamp-based number; the order_number unique index + insert retry keep
// that fallback safe.
async function nextOrderNumber(admin) {
  try {
    const { data, error } = await admin.rpc('pos_next_order_number');
    if (!error && typeof data === 'string' && data) return data;
  } catch {
    // fall through to timestamp fallback
  }
  return formatOrderNumber(Date.now());
}
