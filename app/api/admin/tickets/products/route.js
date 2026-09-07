import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/auth-helpers';
import { isInternalTicketingEnabled } from '@/lib/feature-flags';

// Admin CRUD for ticket_products + their price tiers.
//
// GET  ?event_id=...  -> list products (with tiers + inventory + sold counts)
// POST body: {
//   id?, event_id, name, description, member_only, min_per_order,
//   max_per_order, capacity, display_order, is_active,
//   tier_reveal_threshold,
//   tiers: [{
//     id?, name, price_cents, currency, starts_at, ends_at,
//     display_order, is_active, status, access_codes,
//     booking_fee_cents_override
//   }]
// }
//      -> upsert product + sync tiers
// DELETE ?id=...      -> soft delete (is_active=false) if any sales,
//                        hard delete otherwise.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function GET(request) {
  if (!isInternalTicketingEnabled()) return NextResponse.json({ error: 'Ticketing disabled' }, { status: 404 });
  const gate = await requireAdmin();
  if (gate.unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const eventId = url.searchParams.get('event_id');
  if (!eventId) return NextResponse.json({ error: 'Missing event_id' }, { status: 400 });

  const supabaseAdmin = admin();
  const [productsRes, tiersRes, invRes] = await Promise.all([
    supabaseAdmin
      .from('ticket_products')
      .select('*')
      .eq('event_id', eventId)
      .order('display_order', { ascending: true }),
    supabaseAdmin
      .from('ticket_price_tiers')
      .select('*')
      .in('product_id',
          (await supabaseAdmin.from('ticket_products').select('id').eq('event_id', eventId)).data?.map(p => p.id) || [])
      .order('display_order', { ascending: true }),
    supabaseAdmin.from('ticket_inventory').select('*'),
  ]);

  const tiersByProduct = new Map();
  for (const t of tiersRes.data || []) {
    if (!tiersByProduct.has(t.product_id)) tiersByProduct.set(t.product_id, []);
    tiersByProduct.get(t.product_id).push(t);
  }
  const invByProduct = new Map((invRes.data || []).map((r) => [r.product_id, r]));

  return NextResponse.json({
    products: (productsRes.data || []).map((p) => {
      const inv = invByProduct.get(p.id);
      return {
        ...p,
        tiers: tiersByProduct.get(p.id) || [],
        capacity: inv?.capacity ?? null,
        sold_count: inv?.sold ?? 0,
        reserved_count: inv?.reserved ?? 0,
      };
    }),
  });
}

export async function POST(request) {
  if (!isInternalTicketingEnabled()) return NextResponse.json({ error: 'Ticketing disabled' }, { status: 404 });
  const gate = await requireAdmin();
  if (gate.unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const {
    id, event_id, name, description = null,
    kind = 'tickets',
    member_only = false,
    // Admin UI has removed the min/max inputs — platform now hard-defaults to
    // 1–20. Kept as accepted body fields so any external caller or older client
    // can still pass them (clamped by check constraints in the DB).
    min_per_order = 1,
    max_per_order = 20,
    capacity = null,
    display_order = 0,
    is_active = true,
    tier_reveal_threshold = null,
    sales_start_at = null,
    sales_end_at = null,
    tiers = [],
  } = body || {};
  if (!event_id || !name) return NextResponse.json({ error: 'Missing event_id or name' }, { status: 400 });
  if (kind !== 'tickets' && kind !== 'private_space') {
    return NextResponse.json({ error: "kind must be 'tickets' or 'private_space'" }, { status: 400 });
  }

  const supabaseAdmin = admin();

  // Upsert product.
  const productRow = {
    event_id,
    name,
    description,
    kind,
    member_only,
    min_per_order,
    max_per_order,
    display_order,
    is_active,
    tier_reveal_threshold,
    sales_start_at: sales_start_at || null,
    sales_end_at: sales_end_at || null,
  };
  let productResult;
  if (id) {
    productResult = await supabaseAdmin.from('ticket_products').update(productRow).eq('id', id).select('*').single();
  } else {
    productResult = await supabaseAdmin.from('ticket_products').insert(productRow).select('*').single();
  }
  if (productResult.error) return NextResponse.json({ error: productResult.error.message }, { status: 400 });
  const product = productResult.data;

  // Ensure inventory row exists / update capacity. Zero-out reserved on
  // manual capacity edits (avoid negative-remaining showing up).
  if (capacity !== null && capacity !== undefined) {
    const cap = Number(capacity);
    if (Number.isFinite(cap) && cap >= 0) {
      const { data: existingInv } = await supabaseAdmin
        .from('ticket_inventory')
        .select('product_id')
        .eq('product_id', product.id)
        .maybeSingle();
      if (existingInv) {
        await supabaseAdmin.from('ticket_inventory').update({ capacity: cap }).eq('product_id', product.id);
      } else {
        await supabaseAdmin.from('ticket_inventory').insert({ product_id: product.id, capacity: cap, sold: 0, reserved: 0 });
      }
    }
  }

  // Sync tiers. Delete removed (only if zero sales), upsert kept, insert new.
  const existing = await supabaseAdmin.from('ticket_price_tiers').select('id').eq('product_id', product.id);
  const existingIds = new Set((existing.data || []).map((r) => r.id));
  const incomingIds = new Set(tiers.filter((t) => t.id).map((t) => t.id));
  const toDelete = [...existingIds].filter((tid) => !incomingIds.has(tid));

  for (const tierId of toDelete) {
    const { count } = await supabaseAdmin
      .from('order_items')
      .select('id', { count: 'exact', head: true })
      .eq('tier_id', tierId);
    if (!count) {
      await supabaseAdmin.from('ticket_price_tiers').delete().eq('id', tierId);
    } else {
      await supabaseAdmin.from('ticket_price_tiers').update({ status: 'hidden', is_active: false }).eq('id', tierId);
    }
  }

  for (const t of tiers) {
    const tierRow = {
      product_id: product.id,
      name: t.name,
      price_cents: t.price_cents,
      currency: t.currency || 'usd',
      starts_at: t.starts_at || null,
      ends_at: t.ends_at || null,
      is_active: t.is_active !== false,
      display_order: Number.isFinite(t.display_order) ? t.display_order : 0,
      status: t.status || 'active',
      access_codes: Array.isArray(t.access_codes)
        ? t.access_codes.map((c) => String(c || '').trim().toUpperCase()).filter(Boolean)
        : null,
      booking_fee_cents_override:
        t.booking_fee_cents_override === '' || t.booking_fee_cents_override === null || t.booking_fee_cents_override === undefined
          ? null
          : Number(t.booking_fee_cents_override),
      // Per-tier quantity. null = unlimited; any finite value caps sales for
      // this tier and flips it to sold-out when reached.
      quantity:
        t.quantity === '' || t.quantity === null || t.quantity === undefined
          ? null
          : Math.max(0, Number(t.quantity)),
    };
    if (t.id) {
      await supabaseAdmin.from('ticket_price_tiers').update(tierRow).eq('id', t.id);
    } else {
      await supabaseAdmin.from('ticket_price_tiers').insert(tierRow);
    }
  }

  await supabaseAdmin.from('ticket_audit_log').insert({
    event_id, actor_user_id: gate.user.id, actor_role: 'admin',
    action: id ? 'product.update' : 'product.create',
    detail: { product_id: product.id, name },
  });

  return NextResponse.json({ product });
}

export async function DELETE(request) {
  if (!isInternalTicketingEnabled()) return NextResponse.json({ error: 'Ticketing disabled' }, { status: 404 });
  const gate = await requireAdmin();
  if (gate.unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const supabaseAdmin = admin();
  const { count } = await supabaseAdmin
    .from('order_items')
    .select('id', { count: 'exact', head: true })
    .eq('product_id', id);

  if (count) {
    await supabaseAdmin.from('ticket_products').update({ is_active: false }).eq('id', id);
    return NextResponse.json({ ok: true, soft: true });
  }

  await supabaseAdmin.from('ticket_products').delete().eq('id', id);
  return NextResponse.json({ ok: true, soft: false });
}
