// Safe for client imports. No banking data belongs in this feature.
export const PAYOUT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PAYOUT_LABELS = {
  unknown: 'Submission unconfirmed',
  pending_approval: 'Awaiting Mercury approval',
  approved: 'Approved in Mercury - settlement not verified',
  rejected: 'Rejected in Mercury',
  cancelled: 'Cancelled in Mercury',
};

export function payoutBlockReason(request, enabled) {
  if (request.payout?.mercury_request_id) return null;
  if (!enabled) return 'Mercury queueing is not enabled.';
  if (request.status !== 'approved') return 'Approve this pay request first.';
  if (request.w9_on_file !== true) return 'W9 required before payout.';
  if (!request.payout && !request.mercury_recipient_id) return 'Link this contact to a Mercury recipient first.';
  return null;
}

export function validRecipientLink(body) {
  return body && typeof body === 'object' && !Array.isArray(body)
    && Object.keys(body).every((key) => ['mercury_recipient_id', 'confirmed_in_mercury'].includes(key))
    && typeof body.mercury_recipient_id === 'string'
    && PAYOUT_UUID.test(body.mercury_recipient_id)
    && body.confirmed_in_mercury === true;
}
