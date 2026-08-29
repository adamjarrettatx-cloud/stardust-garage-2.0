import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NOTIFICATION_KINDS,
  assertNoSecrets,
  buildContractNotification,
  recordContractNotification,
  markNotificationEmailed,
} from '../lib/contract-notify.js';

const CONTRACT_ID = '11111111-1111-1111-1111-111111111111';
const DOCUMENT_ID = '22222222-2222-2222-2222-222222222222';
const CONTACT_ID = '33333333-3333-3333-3333-333333333333';

const organizer = {
  display_name: 'Bassment Sessions',
  legal_name: 'Bassment Sessions LLC',
};

function base(overrides = {}) {
  return {
    contractId: CONTRACT_ID,
    documentId: DOCUMENT_ID,
    contactId: CONTACT_ID,
    documentTitle: 'Bassment Sessions — Event Agreement',
    organizer,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Secret scanning — defense in depth for outbound copy
// ---------------------------------------------------------------------------

test('assertNoSecrets passes ordinary contract copy', () => {
  assert.equal(assertNoSecrets('Please sign by Friday.'), 'Please sign by Friday.');
  assert.equal(assertNoSecrets('https://sdgatx.com/portal/contracts'), 'https://sdgatx.com/portal/contracts');
  assert.equal(assertNoSecrets(null), '');
});

test('assertNoSecrets throws on credentials and private file URLs', () => {
  const hostile = [
    'key sb_secret_abc123DEF456',
    'use the service_role key',
    'token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig',
    'Authorization: Bearer abcdefghijklmnop',
    'SIGNNOW_API_KEY=whatever',
    'https://x.supabase.co/storage/v1/object/sign/documents/a.pdf',
    'https://example.com/file.pdf?token=abcdefghijklmnop',
  ];
  for (const value of hostile) {
    assert.throws(() => assertNoSecrets(value, 'test'), /credential or private URL/, value);
  }
});

// ---------------------------------------------------------------------------
// Payload building
// ---------------------------------------------------------------------------

test('buildContractNotification builds a signature request payload', () => {
  const p = buildContractNotification(
    base({ eventTitle: 'Bassment Sessions 012', eventDate: '2026-09-19' }),
  );
  assert.equal(p.contract_id, CONTRACT_ID);
  assert.equal(p.document_id, DOCUMENT_ID);
  assert.equal(p.contact_id, CONTACT_ID);
  assert.equal(p.kind, 'signature_requested');
  assert.match(p.title, /needs your signature/);
  assert.match(p.body, /Bassment Sessions 012 · 2026-09-19/);
  assert.match(p.body, /Signing as: Bassment Sessions LLC \(dba Bassment Sessions\)/);
});

test('buildContractNotification marks a resend as a reminder', () => {
  const p = buildContractNotification(base({ isResend: true }));
  assert.match(p.title, /^Reminder: /);
  assert.match(p.body, /reminder/i);
});

test('buildContractNotification covers every declared kind', () => {
  for (const kind of NOTIFICATION_KINDS) {
    const p = buildContractNotification(base({ kind }));
    assert.equal(p.kind, kind);
    assert.ok(p.title.length > 0, kind);
    assert.ok(p.body.length > 0, kind);
  }
});

test('buildContractNotification never emits a signing link or file pointer', () => {
  // The whole point of the notice: it tells the signer to check their email, and
  // the only URL a signer ever gets from us is the authenticated portal page.
  const p = buildContractNotification(
    base({ expirationDate: '2026-09-18T17:00:00.000Z', eventTitle: 'Bassment Sessions 012' }),
  );
  const blob = `${p.title} ${p.body}`;
  assert.equal(/https?:\/\//.test(blob), false);
  assert.equal(/storage\/v1/.test(blob), false);
  assert.equal(blob.includes(CONTRACT_ID), false);
  assert.equal(blob.includes(DOCUMENT_ID), false);
  assert.match(blob, /secure signing link/);
});

test('buildContractNotification rejects unknown kinds and missing ids', () => {
  assert.throws(() => buildContractNotification(base({ kind: 'nope' })), /unknown notification kind/);
  assert.throws(() => buildContractNotification(base({ contractId: null })), /are required/);
  assert.throws(() => buildContractNotification(base({ documentId: null })), /are required/);
  assert.throws(() => buildContractNotification(base({ contactId: null })), /are required/);
});

test('buildContractNotification refuses a document title carrying a secret', () => {
  assert.throws(
    () => buildContractNotification(base({ documentTitle: 'Contract sb_secret_abc123DEF456' })),
    /credential or private URL/,
  );
});

test('buildContractNotification tolerates a missing title, organizer and event', () => {
  const p = buildContractNotification({
    contractId: CONTRACT_ID,
    documentId: DOCUMENT_ID,
    contactId: CONTACT_ID,
  });
  assert.match(p.title, /^Contract needs your signature/);
  assert.equal(p.body.includes('Event:'), false);
  assert.equal(p.body.includes('Signing as:'), false);
});

test('buildContractNotification clamps oversized copy', () => {
  const p = buildContractNotification(base({ documentTitle: 'T'.repeat(500) }));
  assert.ok(p.title.length <= 200);
  assert.ok(p.body.length <= 2000);
});

// ---------------------------------------------------------------------------
// Persistence helpers — must never throw into the send path
// ---------------------------------------------------------------------------

function fakeAdmin({ insertResult, updateSpy, throwOn = null }) {
  return {
    from(table) {
      if (throwOn === table) throw new Error('boom');
      return {
        insert() {
          return {
            select() {
              return { single: async () => insertResult };
            },
          };
        },
        update(patch) {
          return {
            eq: async (col, val) => {
              updateSpy?.({ patch, col, val });
              return { error: null };
            },
          };
        },
      };
    },
  };
}

test('recordContractNotification returns the new row id', async () => {
  const admin = fakeAdmin({ insertResult: { data: { id: 'note-1' }, error: null } });
  const id = await recordContractNotification({
    admin,
    payload: buildContractNotification(base()),
    createdBy: 'user-1',
  });
  assert.equal(id, 'note-1');
});

test('recordContractNotification swallows database failures', async () => {
  // A failed notice must never fail a contract SignNow has already accepted.
  const failing = fakeAdmin({ insertResult: { data: null, error: { message: 'nope' } } });
  assert.equal(await recordContractNotification({ admin: failing, payload: {} }), null);

  const throwing = fakeAdmin({ insertResult: null, throwOn: 'contract_notifications' });
  assert.equal(await recordContractNotification({ admin: throwing, payload: {} }), null);
});

test('markNotificationEmailed stamps email_sent_at, and no-ops without an id', async () => {
  const calls = [];
  const admin = fakeAdmin({ insertResult: null, updateSpy: (c) => calls.push(c) });

  await markNotificationEmailed({ admin, notificationId: 'note-1' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].col, 'id');
  assert.equal(calls[0].val, 'note-1');
  assert.ok(calls[0].patch.email_sent_at);

  await markNotificationEmailed({ admin, notificationId: null });
  assert.equal(calls.length, 1);
});

test('markNotificationEmailed swallows database failures', async () => {
  const throwing = fakeAdmin({ insertResult: null, throwOn: 'contract_notifications' });
  await markNotificationEmailed({ admin: throwing, notificationId: 'note-1' });
});
