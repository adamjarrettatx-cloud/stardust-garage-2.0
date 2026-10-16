import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { computeWriteup, organizerView, organizerViewsEqual } from '../lib/event-writeup.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

function sample() {
  return computeWriteup({
    orders: [
      { status: 'paid', total_cents: 3567, tax_cents: 272, refunded_cents: 0, booking_fee_cents: 295 },
      { status: 'paid', total_cents: 7134, tax_cents: 544, refunded_cents: 0, booking_fee_cents: 590 },
    ],
    ticketsSold: 3,
    config: {
      door_gross_cents: 674500,
      organizer_percent: 20,
      notes: 'internal only',
      adjustments: [{ label: 'Artist pay', amount_cents: 120000 }, { label: 'Beverage', amount_cents: -35000 }],
    },
  });
}

test('organizer view is an allowlist with no Stardust Garage take, booking fee or notes', () => {
  const w = sample();
  const v = organizerView(w, { title: 'Show', event_date: '2026-10-10' });
  const json = JSON.stringify(v);
  assert.deepEqual(Object.keys(v).sort(), ['adjustments', 'door', 'event', 'gross_payout_cents', 'net_payout_cents', 'net_ticket_revenue_cents', 'online', 'organizer_percent', 'version']);
  assert.deepEqual(Object.keys(v.online).sort(), ['fees_cents', 'gross_cents', 'net_cents', 'refunds_cents', 'sales_tax_cents', 'tickets_sold']);
  for (const banned of ['stardust', 'keeps', 'booking', 'notes', 'transactions', 'stripe', 'internal only']) {
    assert.ok(!json.toLowerCase().includes(banned), `organizer view must not contain "${banned}"`);
  }
  assert.ok(!json.includes(`:${w.stardustKeepsCents}`), 'Stardust total must not appear');
  assert.ok(!json.includes(`:${w.online.bookingFeesCents},`) && !json.includes(`:${w.online.bookingFeesCents}}`), 'booking fee amount must not appear on its own');
});

test('organizer online figures still reconcile from gross to net', () => {
  const v = organizerView(sample(), {});
  const o = v.online;
  assert.equal(o.gross_cents - o.refunds_cents - o.sales_tax_cents - o.fees_cents, o.net_cents);
  assert.equal(v.net_payout_cents, v.gross_payout_cents + 85000);
});

test('shared-version comparison ignores event label but catches number changes', () => {
  const a = organizerView(sample(), { title: 'A' });
  const b = organizerView(sample(), { title: 'B' });
  assert.ok(organizerViewsEqual(a, b));
  assert.ok(!organizerViewsEqual(a, { ...b, net_payout_cents: b.net_payout_cents + 1 }));
});

test('organizer-facing files never touch Stardust-only values', () => {
  for (const rel of ['app/components/OrganizerWriteup.jsx', 'app/portal/(loggedin)/events/EventSales.jsx']) {
    const src = read(rel);
    assert.doesNotMatch(src, /stardustKeeps|bookingFees|stardust_keeps|booking_fee/i, rel);
  }
});

test('portal proof link is authorized by the database as the partner before any signed URL', () => {
  const src = read('app/api/portal/events/[id]/writeup/proofs/[proofId]/route.js');
  assert.match(src, /requirePartner\(request\)/);
  const rpc = src.indexOf("rpc('partner_event_writeup'");
  const sign = src.indexOf('createSignedUrl');
  assert.ok(rpc > 0 && sign > rpc, 'RPC check must precede signing');
  assert.match(src, /view\?\.shared/);
  assert.match(src, /createSignedUrl\(proof\.path, 60\)/);
});

test('migration restricts the organizer read to the event organizer and hides storage paths', () => {
  const sql = read('supabase/migrations/20261015220000_event_writeup_organizer_share.sql');
  assert.match(sql, /e\.contact_id in \(select id from public\.partner_event_contact_ids\(\)/);
  assert.doesNotMatch(sql.split('create or replace function public.partner_event_writeup')[1], /'path'/);
  assert.match(sql, /'event-writeup-proofs', 'event-writeup-proofs', false/);
  assert.match(sql, /revoke all on function public\.partner_event_writeup\(uuid\) from public, anon/);
});

test('admin write-up routes require admin MFA', () => {
  for (const rel of [
    'app/api/admin/events/[id]/writeup/route.js',
    'app/api/admin/events/[id]/writeup/share/route.js',
    'app/api/admin/events/[id]/writeup/proofs/route.js',
    'app/api/admin/events/[id]/writeup/proofs/upload-url/route.js',
    'app/api/admin/events/[id]/writeup/proofs/[proofId]/route.js',
  ]) assert.match(read(rel), /requireAdminMfa\(\)/, rel);
});
