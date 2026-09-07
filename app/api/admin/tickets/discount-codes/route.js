import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/auth-helpers';
import { isInternalTicketingEnabled } from '@/lib/feature-flags';

// Admin CRUD for ticket_discount_codes. Event-scoped promo codes distinct
// from member_discount_codes (which is the TicketTailor per-member pipeline).
//
// GET  ?event_id=...          -> list codes for one event
// POST body: { id?, event_id, code, discount_type, discount_value,
//              applies_to, product_ids, max_redemptions,
//              starts_at, ends_at, is_active }
//        -> insert or update
// DELETE ?id=...              -> delete (hard; safe because redemptions
//                                 are snapshotted onto orders)

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
  const { data, error } = await supabaseAdmin
    .from('ticket_discount_codes')
    .select('*')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ codes: data || [] });
}

export async function POST(request) {
  if (!isInternalTicketingEnabled()) return NextResponse.json({ error: 'Ticketing disabled' }, { status: 404 });
  const gate = await requireAdmin();
  if (gate.unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const {
    id, event_id, code, discount_type, discount_value,
    applies_to = 'all_products', product_ids = null,
    max_redemptions = null, starts_at = null, ends_at = null,
    is_active = true,
  } = body || {};

  if (!event_id || !code || !discount_type) {
    return NextResponse.json({ error: 'Missing event_id, code, or discount_type' }, { status: 400 });
  }
  if (!['percent', 'amount', 'target_total'].includes(discount_type)) {
    return NextResponse.json({ error: 'discount_type must be percent, amount, or target_total' }, { status: 400 });
  }
  const value = Number(discount_value);
  if (!Number.isFinite(value) || value < 0) {
    return NextResponse.json({ error: 'discount_value must be a non-negative number' }, { status: 400 });
  }
  if (discount_type === 'percent' && value > 100) {
    return NextResponse.json({ error: 'percent discount must be 0-100' }, { status: 400 });
  }
  // target_total stores cents; 0 would mean "give it away free" and is allowed
  // but rejecting sub-cent nonsense is enforced by the >= 0 check above.
  if (!['all_products', 'specific'].includes(applies_to)) {
    return NextResponse.json({ error: 'applies_to must be all_products or specific' }, { status: 400 });
  }
  if (applies_to === 'specific' && (!Array.isArray(product_ids) || !product_ids.length)) {
    return NextResponse.json({ error: 'product_ids required when applies_to=specific' }, { status: 400 });
  }

  const row = {
    event_id,
    code: String(code).trim().toUpperCase(),
    discount_type,
    discount_value: Math.floor(value),
    applies_to,
    product_ids: applies_to === 'specific' ? product_ids : null,
    max_redemptions: Number.isFinite(Number(max_redemptions)) && max_redemptions !== null
      ? Number(max_redemptions)
      : null,
    starts_at: starts_at || null,
    ends_at: ends_at || null,
    is_active: !!is_active,
    updated_at: new Date().toISOString(),
  };

  const supabaseAdmin = admin();
  let result;
  if (id) {
    result = await supabaseAdmin.from('ticket_discount_codes').update(row).eq('id', id).select('*').single();
  } else {
    row.created_by = gate.user.id;
    result = await supabaseAdmin.from('ticket_discount_codes').insert(row).select('*').single();
  }
  if (result.error) {
    if (result.error.code === '23505') {
      return NextResponse.json({ error: 'A code with that name already exists for this event' }, { status: 409 });
    }
    return NextResponse.json({ error: result.error.message }, { status: 400 });
  }

  return NextResponse.json({ code: result.data });
}

export async function DELETE(request) {
  if (!isInternalTicketingEnabled()) return NextResponse.json({ error: 'Ticketing disabled' }, { status: 404 });
  const gate = await requireAdmin();
  if (gate.unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const supabaseAdmin = admin();
  const { error } = await supabaseAdmin.from('ticket_discount_codes').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
