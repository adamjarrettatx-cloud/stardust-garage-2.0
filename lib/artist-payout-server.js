import { NextResponse } from 'next/server';
import { requireOwnerMfa } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSameOrigin } from '@/lib/manual-income';
import { PAYOUT_UUID } from '@/lib/artist-payout-helpers';
import { mercuryConfig, mercuryApproval, MercuryError } from '@/lib/mercury';

const DATABASE_ERRORS = {
  request_not_found: [404, 'Pay request not found.'],
  contact_not_found: [404, 'Contact not found.'],
  request_not_approved: [409, 'Approve this pay request first.'],
  recipient_required: [409, 'Link this contact to a Mercury recipient first.'],
  w9_required: [409, 'W9 required before payout.'],
  payout_busy: [409, 'This request is being processed. Wait two minutes before retrying.'],
  payout_in_progress: [409, 'Reconcile existing Mercury payouts before changing this recipient.'],
  no_mercury_request: [409, 'No confirmed Mercury request to refresh.'],
  mercury_config_changed: [409, 'Mercury account or environment changed. Reconcile this request before continuing.'],
  confirmation_changed: [409, 'The recipient or amount changed. Reload and review the payout again.'],
};

export function payoutDatabaseError(error) {
  const [status, message] = DATABASE_ERRORS[error?.message] || (
    error?.code === '23505'
      ? [409, 'That Mercury reference is already linked. Check the existing record before continuing.']
      : [503, 'Payout records are unavailable. Check the migration and reconcile Mercury before retrying.']
  );
  return NextResponse.json({ error: message }, { status });
}

export async function payoutAccess(request, { write = true } = {}) {
  const auth = await requireOwnerMfa();
  if (auth.unauthorized) {
    return { response: NextResponse.json({ error: 'Owner access required.', reason: auth.reason }, { status: 401 }) };
  }
  if (write && !isSameOrigin(request.headers.get('origin'), request.headers.get('host'))) {
    return { response: NextResponse.json({ error: 'Cross-origin request rejected.' }, { status: 403 }) };
  }
  return { user: auth.user };
}

export async function handleMercuryPayout(request, { params }, { refresh = false } = {}) {
  const access = await payoutAccess(request);
  if (access.response) return access.response;
  const { id } = await params;
  if (!PAYOUT_UUID.test(id)) return NextResponse.json({ error: 'Bad id.' }, { status: 400 });
  const body = await request.json().catch(() => null);
  const allowed = refresh ? [] : ['confirmed', 'expected_recipient_id', 'expected_amount_cents'];
  if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some((key) => !allowed.includes(key))
      || (!refresh && (body.confirmed !== true
        || !PAYOUT_UUID.test(body.expected_recipient_id || '')
        || !Number.isSafeInteger(body.expected_amount_cents) || body.expected_amount_cents <= 0))) {
    return NextResponse.json({ error: 'Review and confirm the recipient and amount. Do not submit banking details.' }, { status: 400 });
  }
  const config = mercuryConfig();
  if (!config.enabled) return NextResponse.json({ error: 'Mercury queueing is not enabled.' }, { status: 503 });
  const admin = createAdminClient();
  const { data: claim, error: claimError } = await admin.rpc('claim_artist_mercury_payout', {
    p_request_id: id,
    p_actor_id: access.user.id,
    p_account_id: config.accountId,
    p_environment: config.mode,
    p_refresh: refresh,
    p_expected_recipient_id: refresh ? null : body.expected_recipient_id,
    p_expected_amount_cents: refresh ? null : body.expected_amount_cents,
  });
  if (claimError || !claim?.payout) return payoutDatabaseError(claimError);
  if (claim.skip) return NextResponse.json({ ok: true, status: claim.payout.status, already_queued: true });

  let result;
  try {
    result = await mercuryApproval(claim.payout, { refresh, config });
  } catch (error) {
    // Never log provider errors or response bodies: they can contain sensitive data.
    const safe = error instanceof MercuryError
      ? error : new MercuryError('unexpected_error', 'Could not confirm the Mercury result. Check Mercury before retrying.');
    const { error: recordError } = await admin.rpc('finish_artist_mercury_payout', {
      p_request_id: id, p_lease_token: claim.lease_token, p_actor_id: access.user.id,
      p_mercury_request_id: null, p_status: null, p_error_code: safe.code,
    });
    if (recordError) return payoutDatabaseError(recordError);
    return NextResponse.json({ error: safe.message, unconfirmed: !refresh }, { status: 502 });
  }
  const { data: saved, error: saveError } = await admin.rpc('finish_artist_mercury_payout', {
    p_request_id: id, p_lease_token: claim.lease_token, p_actor_id: access.user.id,
    p_mercury_request_id: result.mercury_request_id, p_status: result.status,
    p_error_code: null,
  });
  if (saveError || !saved) {
    // Keep the durable snapshot/lease. Retrying uses exactly the same key.
    return NextResponse.json({
      error: 'Mercury responded, but SDG could not save the result. Check Mercury before retrying this same request.',
      unconfirmed: true,
    }, { status: 503 });
  }
  return NextResponse.json({ ok: true, status: saved.status });
}
