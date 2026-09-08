// app/api/admin/waiver-acceptances/route.js  (NEW)
//
// Admin-only read endpoint. Query by order_id, ticket code, email, event,
// or date range. Used by the admin ticket detail page ("show the waiver
// record for this order") and by the ops/legal export tab.

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-helpers";
import { createAdminClient } from "@/lib/supabase/admin";
import { waiverBySlug } from "@/lib/waiver/versions";

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const gate = await requireAdmin();
  if (gate.unauthorized) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const orderId       = url.searchParams.get("order_id");
  const ttOrderId     = url.searchParams.get("tickettailor_order_id");
  const email         = url.searchParams.get("email");
  const eventId       = url.searchParams.get("event_id");
  const from          = url.searchParams.get("from");   // ISO
  const to            = url.searchParams.get("to");     // ISO
  const source        = url.searchParams.get("source"); // internal_ticket|tickettailor|admin_comp|rsvp|wallet_setup
  const limit         = Math.min(Number(url.searchParams.get("limit") ?? 100), 500);

  const supabase = createAdminClient();
  let q = supabase
    .from("waiver_acceptances")
    .select(
      "id, accepted_at, source, waiver_slug, waiver_body_sha256, user_id, buyer_email, buyer_name, order_id, tickettailor_order_id, event_id, hold_id, external_ref, ip_address, user_agent, page_url, request_id"
    )
    .order("accepted_at", { ascending: false })
    .limit(limit);

  if (orderId)   q = q.eq("order_id", orderId);
  if (ttOrderId) q = q.eq("tickettailor_order_id", ttOrderId);
  if (email)     q = q.ilike("buyer_email", email.toLowerCase());
  if (eventId)   q = q.eq("event_id", eventId);
  if (source)    q = q.eq("source", source);
  if (from)      q = q.gte("accepted_at", from);
  if (to)        q = q.lte("accepted_at", to);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Enrich with the human-readable version + body length for the UI
  const rows = (data ?? []).map((r) => {
    const w = waiverBySlug(r.waiver_slug);
    return {
      ...r,
      waiver_version_human: w ? w.version : null,
      waiver_hash_matches_current: w ? w.bodySha256 === r.waiver_body_sha256 : null,
    };
  });

  return NextResponse.json({ rows, count: rows.length });
}
