// Counterparty notification for contracts awaiting signature.
//
// Two channels, both fired when a contract is sent or resent:
//   1. An in-app task row in public.contract_notifications, which the Event
//      Organizer reads at /portal/contracts (gated by requirePartner() and the
//      partner_contracts() definer RPC).
//   2. An email notice via lib/email.js.
//
// SECURITY CONTRACT for everything in this module:
//   * No SignNow token, Supabase key, envelope id or storage path is ever put
//     into a notification row or an email body. The notice is a pointer, not a
//     payload — the actual signing act happens through SignNow's own secure
//     emailed invite, and the portal only links to /portal/contracts.
//   * buildContractNotification() is pure so it can be unit tested without a
//     database or an outbound request.

import { organizerDisplayLabel } from './event-organizer.js';
import { formatVenueDateTime } from './contract-helpers.js';

export const NOTIFICATION_KINDS = [
  'signature_requested',
  'signature_reminder',
  'signature_completed',
  'contract_canceled',
];

// Patterns for things that must never reach a notification body or an email.
// Used by assertNoSecrets() below as a defense-in-depth check rather than as the
// primary control (the primary control is simply not passing secrets in).
const SECRET_PATTERNS = [
  /\bsb_secret_[A-Za-z0-9_-]+/i,
  /\bservice_role\b/i,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, // JWT
  /\bBearer\s+[A-Za-z0-9._-]{12,}/i,
  /signnow[._-]?(api[._-]?key|secret|token|basic)/i,
  /supabase[._-]?(service[._-]?role|secret)/i,
  // Signed/private storage URLs.
  /\/storage\/v1\/object\/(sign|authenticated)\//i,
  /[?&]token=[A-Za-z0-9._-]{12,}/i,
];

// Throws if a string looks like it carries a credential or a private file URL.
// Called on every assembled notification body and email parameter.
export function assertNoSecrets(value, label = 'value') {
  const s = String(value ?? '');
  for (const re of SECRET_PATTERNS) {
    if (re.test(s)) {
      throw new Error(`[contract-notify] refusing to send: ${label} looks like it contains a credential or private URL`);
    }
  }
  return s;
}

function eventLine({ eventTitle, eventDate }) {
  const title = String(eventTitle || '').trim();
  if (!title) return '';
  const date = String(eventDate || '').trim();
  return date ? `${title} · ${date}` : title;
}

// Build the in-app notification row payload. Pure: no I/O, no secrets, no
// signing link. Returns { contract_id, document_id, contact_id, kind, title,
// body }.
export function buildContractNotification({
  kind = 'signature_requested',
  contractId,
  documentId,
  contactId,
  documentTitle,
  organizer = null,
  eventTitle = null,
  eventDate = null,
  expirationDate = null,
  isResend = false,
} = {}) {
  if (!NOTIFICATION_KINDS.includes(kind)) {
    throw new Error(`[contract-notify] unknown notification kind: ${kind}`);
  }
  if (!contractId || !documentId || !contactId) {
    throw new Error('[contract-notify] contractId, documentId and contactId are required');
  }

  const docTitle = String(documentTitle || 'Contract').trim() || 'Contract';
  const who = organizerDisplayLabel(organizer);
  const evt = eventLine({ eventTitle, eventDate });

  let title;
  let bodyParts = [];

  if (kind === 'signature_requested') {
    title = isResend ? `Reminder: ${docTitle} needs your signature` : `${docTitle} needs your signature`;
    bodyParts.push(
      isResend
        ? 'This is a reminder that Stardust Garage sent you a contract to sign.'
        : 'Stardust Garage has sent you a contract to sign.',
    );
  } else if (kind === 'signature_reminder') {
    title = `Reminder: ${docTitle} needs your signature`;
    bodyParts.push('This contract is still waiting on your signature.');
  } else if (kind === 'signature_completed') {
    title = `${docTitle} is fully signed`;
    bodyParts.push('Everyone has signed. A copy is on file with Stardust Garage.');
  } else {
    title = `${docTitle} was canceled`;
    bodyParts.push('Stardust Garage canceled this contract. No signature is needed.');
  }

  if (evt) bodyParts.push(`Event: ${evt}.`);
  if (who) bodyParts.push(`Signing as: ${who}.`);
  if (kind !== 'signature_completed' && kind !== 'contract_canceled' && expirationDate) {
    const label = formatVenueDateTime(expirationDate);
    if (label) bodyParts.push(`Please sign by ${label}.`);
  }
  if (kind === 'signature_requested' || kind === 'signature_reminder') {
    bodyParts.push('Check your email for the secure signing link.');
  }

  const body = bodyParts.join(' ');

  return {
    contract_id: contractId,
    document_id: documentId,
    contact_id: contactId,
    kind,
    title: assertNoSecrets(title, 'notification title').slice(0, 200),
    body: assertNoSecrets(body, 'notification body').slice(0, 2000),
  };
}

// Insert the in-app task row. Never throws — a failed notification must not
// undo a contract that SignNow has already accepted. Returns the row id or null.
export async function recordContractNotification({ admin, payload, createdBy = null }) {
  try {
    const { data, error } = await admin
      .from('contract_notifications')
      .insert({ ...payload, created_by: createdBy })
      .select('id')
      .single();
    if (error) {
      console.error('[contract-notify] insert failed', error.message);
      return null;
    }
    return data?.id || null;
  } catch (err) {
    console.error('[contract-notify] insert threw', err);
    return null;
  }
}

// Stamp email_sent_at once the email actually went out. Best-effort.
export async function markNotificationEmailed({ admin, notificationId }) {
  if (!notificationId) return;
  try {
    await admin
      .from('contract_notifications')
      .update({ email_sent_at: new Date().toISOString() })
      .eq('id', notificationId);
  } catch (err) {
    console.error('[contract-notify] email stamp failed', err);
  }
}
