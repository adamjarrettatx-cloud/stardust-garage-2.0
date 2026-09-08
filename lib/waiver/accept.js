// lib/waiver/accept.js
//
// Server-side helper for recording a waiver acceptance and validating
// client-submitted waiver payloads. Called from every write path that
// creates a ticket record:
//
//   - /api/tickets/hold                 (guest + member internal checkout)
//   - /api/stripe/webhook               (final fulfillment persistence)
//   - /api/admin/tickets/comp           (admin comp issuance)
//   - /api/wallet/setup                 (member wallet card-save)
//   - /api/rsvp/claim                   (member RSVP / free-ticket claim)
//   - /api/tickettailor/webhook         (mirrored external ticket sales)
//
// Uses service-role Supabase; never trust the client hash blindly — we
// re-derive from the current active waiver and require an exact match.

import { createClient } from "@supabase/supabase-js";
import { activeWaiver, waiverBySlug } from "./versions.js";

const svc = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

/**
 * Validate a client acceptance payload against the current active waiver.
 * Throws on mismatch — never silently pass.
 *
 * @param {{ slug: string, version: string, bodySha256: string, accepted: boolean }} payload
 * @param {'ticket'} kind
 */
export function validateAcceptancePayload(payload, kind = "ticket") {
  if (!payload || payload.accepted !== true) {
    const err = new Error("WAIVER_NOT_ACCEPTED");
    err.status = 400;
    err.code = "WAIVER_NOT_ACCEPTED";
    throw err;
  }
  const active = activeWaiver(kind);
  if (payload.slug !== active.slug || payload.version !== active.version) {
    // Client rendered an older version — refuse and let them re-render.
    const err = new Error("WAIVER_VERSION_STALE");
    err.status = 409;
    err.code = "WAIVER_VERSION_STALE";
    err.expected = { slug: active.slug, version: active.version };
    throw err;
  }
  if (
    typeof payload.bodySha256 !== "string" ||
    payload.bodySha256.toUpperCase() !== active.bodySha256
  ) {
    const err = new Error("WAIVER_HASH_MISMATCH");
    err.status = 409;
    err.code = "WAIVER_HASH_MISMATCH";
    throw err;
  }
  return active;
}

/**
 * Record an acceptance row. Idempotency: the caller controls linkage
 * (hold_token OR order_id OR external_ref). Duplicates for the same
 * (source, order_id, waiver_version_id) are OK and expected on Stripe
 * webhook replays — we insert; a downstream unique index (see plan)
 * makes those a no-op if you want strict dedup.
 *
 * @param {object} args
 * @param {'internal_ticket'|'tickettailor'|'admin_comp'|'rsvp'|'wallet_setup'} args.source
 * @param {'ticket'} [args.kind]
 * @param {{ slug: string, version: string, bodySha256: string, accepted: boolean }} args.payload
 * @param {string} [args.userId]
 * @param {string} [args.buyerEmail]
 * @param {string} [args.buyerName]
 * @param {string} [args.orderId]
 * @param {string} [args.tickettailorOrderId]
 * @param {string} [args.eventId]
 * @param {string} [args.holdId]
 * @param {string} [args.externalRef]
 * @param {string} [args.ip]
 * @param {string} [args.userAgent]
 * @param {string} [args.pageUrl]
 * @param {string} [args.requestId]
 */
export async function recordWaiverAcceptance(args) {
  const kind = args.kind ?? "ticket";
  const active = validateAcceptancePayload(args.payload, kind);

  const supabase = svc();

  // Resolve waiver_version_id (DB is source of truth; code is display source).
  const { data: verRow, error: verErr } = await supabase
    .from("waiver_versions")
    .select("id, body_sha256, is_active")
    .eq("slug", active.slug)
    .single();

  if (verErr || !verRow) {
    throw new Error(
      `waiver_versions row missing for slug=${active.slug} — run scripts/seed-waiver.mjs`
    );
  }
  if (verRow.body_sha256 !== active.bodySha256) {
    // Code and DB drifted — refuse to record until seed script is re-run.
    throw new Error(
      `waiver hash drift for slug=${active.slug}: db=${verRow.body_sha256} code=${active.bodySha256}`
    );
  }
  if (!verRow.is_active) {
    throw new Error(`waiver slug=${active.slug} is not active in DB`);
  }

  const insert = {
    waiver_version_id: verRow.id,
    waiver_slug: active.slug,
    waiver_body_sha256: active.bodySha256,
    source: args.source,
    user_id: args.userId ?? null,
    buyer_email: args.buyerEmail ? args.buyerEmail.toLowerCase() : null,
    buyer_name: args.buyerName ?? null,
    order_id: args.orderId ?? null,
    tickettailor_order_id: args.tickettailorOrderId ?? null,
    event_id: args.eventId ?? null,
    hold_id: args.holdId ?? null,
    external_ref: args.externalRef ?? null,
    ip_address: args.ip ?? null,
    user_agent: args.userAgent ?? null,
    page_url: args.pageUrl ?? null,
    request_id: args.requestId ?? null,
  };

  const { data, error } = await supabase
    .from("waiver_acceptances")
    .insert(insert)
    .select("id, accepted_at")
    .single();

  if (error) throw error;
  return data;
}

/**
 * Convenience: from a Next.js Request, pull ip/ua/page/request-id for the row.
 */
export function evidenceFromRequest(req) {
  const h = req.headers;
  const forwarded = h.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0].trim() || h.get("x-real-ip") || null;
  return {
    ip,
    userAgent: h.get("user-agent") ?? null,
    pageUrl: h.get("referer") ?? null,
    requestId: h.get("x-vercel-id") ?? null,
  };
}

/**
 * Backfill helper: given an order_id after Stripe webhook, promote any
 * hold-token-scoped acceptance to also carry the order_id. Called from
 * the ticket-fulfillment webhook handler after order insertion.
 */
export async function linkAcceptanceToOrder({ holdId, orderId, eventId }) {
  if (!holdId || !orderId) return { linked: 0 };
  const supabase = svc();

  // waiver_acceptances is immutable, so instead of updating the row we
  // insert a linkage row with the same waiver + evidence but the order_id
  // populated. This preserves the pre-payment acceptance record AND
  // creates the queryable order↔waiver link the admin UI needs.
  const { data: src, error: srcErr } = await supabase
    .from("waiver_acceptances")
    .select("*")
    .eq("hold_id", holdId)
    .order("accepted_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (srcErr) throw srcErr;
  if (!src) return { linked: 0 }; // hold submitted with no waiver row — should never happen with WAIVER_GATE_ENABLED=true

  const { error: insErr } = await supabase.from("waiver_acceptances").insert({
    waiver_version_id: src.waiver_version_id,
    waiver_slug: src.waiver_slug,
    waiver_body_sha256: src.waiver_body_sha256,
    source: "internal_ticket",
    user_id: src.user_id,
    buyer_email: src.buyer_email,
    buyer_name: src.buyer_name,
    order_id: orderId,
    event_id: eventId ?? src.event_id,
    hold_id: holdId,
    external_ref: `linked_from:${src.id}`,
    ip_address: src.ip_address,
    user_agent: src.user_agent,
    page_url: src.page_url,
    request_id: src.request_id,
    accepted_at: src.accepted_at, // preserve original accept timestamp
  });
  if (insErr) throw insErr;
  return { linked: 1, sourceAcceptanceId: src.id };
}
