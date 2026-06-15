import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { isValidRestrictedPolicy } from '@/lib/pos-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;

// PATCH /api/pos/products/:id — update a product (admin only).
export async function PATCH(request, { params }) {
  const { unauthorized } = await requireAdmin();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Bad body' }, { status: 400 }); }

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
  if (typeof body.restricted_tender_policy === 'string') {
    if (!isValidRestrictedPolicy(body.restricted_tender_policy)) {
      return NextResponse.json({ error: 'Invalid restricted tender policy.' }, { status: 400 });
    }
    patch.restricted_tender_policy = body.restricted_tender_policy;
  }
  if (body.sort_order != null) patch.sort_order = Math.trunc(Number(body.sort_order)) || 0;

  if (!Object.keys(patch).length) return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
  if (patch.name === '') return NextResponse.json({ error: 'Name cannot be empty.' }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin.from('pos_products').update(patch).eq('id', id).select().single();
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'A product with that SKU already exists.' }, { status: 409 });
    return NextResponse.json({ error: 'Update failed.' }, { status: 500 });
  }
  return NextResponse.json({ product: data });
}

// DELETE /api/pos/products/:id — soft delete by deactivating (admin only).
// We never hard-delete: order_items snapshot the product, and pos_products rows
// may be referenced historically. Deactivating hides it from the register.
export async function DELETE(request, { params }) {
  const { unauthorized } = await requireAdmin();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const admin = createAdminClient();
  const { error } = await admin.from('pos_products').update({ active: false }).eq('id', id);
  if (error) return NextResponse.json({ error: 'Failed to deactivate product.' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
