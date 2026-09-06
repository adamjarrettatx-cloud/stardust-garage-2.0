import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/auth-helpers';
import { isInternalTicketingEnabled } from '@/lib/feature-flags';

// Admin CRUD for ticket_products + their price tiers.
//   GET  ?event_id=...  -> list products + tiers for one event
//   POST body: { event_id, name, description, member_only, max_per_order,
//                total_inventory, sort_order, is_active,
//                tiers: [{ name, price_cents, starts_at, ends_at, is_active, sort_order }] }
//        -> create/update via upsert-by-id (if id present) or insert
//   DELETE ?id=...      -> soft delete (is_active=false); hard delete only if no sales
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
  const [products, tiers] = await Promise.all([
    supabaseAdmin.from('ticket_products').select('*').eq('event_id', eventId).order('sort_order', { ascending: true }),
    supabaseAdmin.from('ticket_price_tiers').select('*').eq('event_id', eventId).order('sort_order', { ascending: true }),
  ]);

  const tiersByProduct = new Map();
  for (const t of tiers.data || []) {
    if (!tiersByProduct.has(t.product_id)) tiersByProduct.set(t.product_id, []);
    tiersByProduct.get(t.product_id).push(t);
  }

  return NextResponse.json({
    products: (products.data || []).map((p) => ({ ...p, tiers: tiersByProduct.get(p.id) || [] })),
  });
}

export async function POST(request) {
  if (!isInternalTicketingEnabled()) return NextResponse.json({ error: 'Ticketing disabled' }, { status: 404 });
  const gate = await requireAdmin();
  if (gate.unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const {
    id, event_id, name, description = null, member_only = false, max_per_order = 10,
    total_inventory = null, sort_order = 0, is_active = true, tiers = [],
  } = body || {};
  if (!event_id || !name) return NextResponse.json({ error: 'Missing event_id or name' }, { status: 400 });

  const supabaseAdmin = admin();

  // Upsert product.
  const productRow = {
    event_id, name, description, member_only, max_per_order,
    total_inventory, sort_order, is_active,
  };
  let productResult;
  if (id) {
    productResult = await supabaseAdmin.from('ticket_products').update(productRow).eq('id', id).select('*').single();
  } else {
    productResult = await supabaseAdmin.from('ticket_products').insert(productRow).select('*').single();
  }
  if (productResult.error) return NextResponse.json({ error: productResult.error.message }, { status: 400 });
  const product = productResult.data;

  // Sync tiers. Delete removed, upsert kept, insert new. Guard: only delete
  // tiers with zero sales so history isn't broken.
  const existingIds = new Set();
  const existing = await supabaseAdmin.from('ticket_price_tiers').select('id').eq('product_id', product.id);
  for (const r of existing.data || []) existingIds.add(r.id);

  const incomingIds = new Set(tiers.filter((t) => t.id).map((t) => t.id));
  const toDelete = [...existingIds].filter((tid) => !incomingIds.has(tid));

  for (const tierId of toDelete) {
    const { count } = await supabaseAdmin
      .from('order_items')
      .select('id', { count: 'exact', head: true })
      .eq('price_tier_id', tierId);
    if (!count) {
      await supabaseAdmin.from('ticket_price_tiers').delete().eq('id', tierId);
    } else {
      await supabaseAdmin.from('ticket_price_tiers').update({ is_active: false }).eq('id', tierId);
    }
  }

  for (const t of tiers) {
    const tierRow = {
      product_id: product.id,
      event_id,
      name: t.name,
      price_cents: t.price_cents,
      currency: t.currency || 'usd',
      starts_at: t.starts_at || null,
      ends_at: t.ends_at || null,
      is_active: t.is_active !== false,
      sort_order: t.sort_order ?? 0,
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
    // Soft delete — keep history intact.
    await supabaseAdmin.from('ticket_products').update({ is_active: false }).eq('id', id);
    return NextResponse.json({ ok: true, soft: true });
  }

  await supabaseAdmin.from('ticket_products').delete().eq('id', id);
  return NextResponse.json({ ok: true, soft: false });
}
