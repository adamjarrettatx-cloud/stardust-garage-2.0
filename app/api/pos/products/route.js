import { NextResponse } from 'next/server';
import { requireAdmin, requireTeam } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { isValidRestrictedPolicy } from '@/lib/pos-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/pos/products — list products (team-readable for the register).
export async function GET(request) {
  const { unauthorized } = await requireTeam();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const activeOnly = url.searchParams.get('active') === '1';

  const admin = createAdminClient();
  let query = admin
    .from('pos_products')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (activeOnly) query = query.eq('active', true);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: 'Failed to load products' }, { status: 500 });
  return NextResponse.json({ products: data || [] });
}

function parseProductBody(body) {
  const patch = {};
  if (typeof body.name === 'string') patch.name = body.name.trim();
  if (typeof body.description === 'string') patch.description = body.description.trim() || null;
  if (typeof body.sku === 'string') patch.sku = body.sku.trim() || null;
  if (typeof body.barcode === 'string') patch.barcode = body.barcode.trim() || null;
  if (typeof body.category === 'string') patch.category = body.category.trim() || null;
  if (body.price_cents != null) patch.price_cents = Math.max(0, Math.trunc(Number(body.price_cents)));
  if (body.tax_rate_bps != null) patch.tax_rate_bps = Math.min(10000, Math.max(0, Math.trunc(Number(body.tax_rate_bps))));
  if (typeof body.taxable === 'boolean') patch.taxable = body.taxable;
  if (typeof body.active === 'boolean') patch.active = body.active;
  if (typeof body.age_restricted === 'boolean') patch.age_restricted = body.age_restricted;
  if (typeof body.restricted_tender_policy === 'string') patch.restricted_tender_policy = body.restricted_tender_policy;
  if (body.sort_order != null) patch.sort_order = Math.trunc(Number(body.sort_order)) || 0;
  return patch;
}

// POST /api/pos/products — create a product (admin only).
export async function POST(request) {
  const { unauthorized } = await requireAdmin();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Bad body' }, { status: 400 }); }

  const patch = parseProductBody(body);
  if (!patch.name) return NextResponse.json({ error: 'Name is required.' }, { status: 400 });
  if (patch.restricted_tender_policy && !isValidRestrictedPolicy(patch.restricted_tender_policy)) {
    return NextResponse.json({ error: 'Invalid restricted tender policy.' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.from('pos_products').insert(patch).select().single();
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'A product with that SKU already exists.' }, { status: 409 });
    return NextResponse.json({ error: 'Failed to create product.' }, { status: 500 });
  }
  return NextResponse.json({ product: data });
}
