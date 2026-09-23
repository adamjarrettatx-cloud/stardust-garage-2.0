import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

let db;
const contact = '11111111-1111-4111-8111-111111111111';
const booking = '22222222-2222-4222-8222-222222222222';
const request = '33333333-3333-4333-8333-333333333333';
const actor = '44444444-4444-4444-8444-444444444444';
const recipient = '55555555-5555-4555-8555-555555555555';
const account = '66666666-6666-4666-8666-666666666666';
const mercuryRequest = '88888888-8888-4888-8888-888888888888';

beforeAll(async () => {
  db = new PGlite();
  // Minimal prior-phase schema. The exact migration under test is loaded below.
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key);
    create table public.contacts(id uuid primary key);
    create table public.events(id uuid primary key, title text, event_date date, event_time text);
    create table public.event_bookings(id uuid primary key, contact_id uuid, event_id uuid,
      slot_start timestamptz, slot_end timestamptz, pay_type text,
      hourly_rate_cents integer, flat_amount_cents integer, hours_worked numeric, status text);
    create table public.artist_pay_requests(id uuid primary key, booking_id uuid, contact_id uuid,
      event_id uuid, amount_cents integer, status text, rejection_reason text, created_at timestamptz default now());
    create table public.contact_tax_profiles(contact_id uuid primary key, w9_on_file boolean);
    create table public.artist_pay_audit_log(id uuid default gen_random_uuid(), action text,
      actor_id uuid, request_id uuid, booking_id uuid, details jsonb,
      constraint artist_pay_audit_log_action_check check(action in ('pay_requested','pay_approved','pay_rejected','pay_reopened')));
    create function public.partner_contact_id() returns uuid language sql as $$ select null::uuid $$;
  `);
  await db.exec(readFileSync(new URL('../../supabase/migrations/20260922110000_artist_pay_manual_mercury.sql', import.meta.url), 'utf8'));
}, 30000);

beforeEach(async () => {
  await db.exec(`
    truncate artist_pay_audit_log, artist_pay_payouts, contact_payout_profiles,
      contact_tax_profiles, artist_pay_requests, event_bookings, contacts, auth.users cascade;
    insert into auth.users values ('${actor}');
    insert into contacts values ('${contact}');
    insert into event_bookings(id, contact_id, status) values ('${booking}', '${contact}', 'approved');
    insert into artist_pay_requests(id, booking_id, contact_id, amount_cents, status)
      values ('${request}', '${booking}', '${contact}', 15000, 'approved');
    insert into contact_tax_profiles values ('${contact}', true);
    insert into contact_payout_profiles(contact_id, mercury_recipient_id) values ('${contact}', '${recipient}');
  `);
});
afterAll(async () => { await db?.close(); });

async function claim({ refresh = false, amount = 15000, recipientId = recipient, mode = 'sandbox' } = {}) {
  const result = await db.query(
    'select claim_artist_mercury_payout($1,$2,$3,$4,$5,$6,$7) as result',
    [request, actor, account, mode, refresh, recipientId, amount],
  );
  return result.rows[0].result;
}
async function finish(lease, { status = 'pending_approval', error = null, requestId = mercuryRequest } = {}) {
  const result = await db.query('select finish_artist_mercury_payout($1,$2,$3,$4,$5,$6) as result',
    [request, lease, actor, error ? null : requestId, error ? null : status, error]);
  return result.rows[0].result;
}

describe('actual PostgreSQL payout state machine', () => {
  it('creates a durable immutable snapshot and lease', async () => {
    const result = await claim();
    expect(result.payout).toMatchObject({ amount_cents: 15000, mercury_recipient_id: recipient, environment: 'sandbox', status: 'unknown' });
    expect(result.payout.idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.lease_token).toBeTruthy();
    expect(result.skip).toBe(false);
  });
  it('blocks concurrent/double-click claims while the lease is active', async () => {
    await claim();
    await expect(claim()).rejects.toThrow('payout_busy');
  });
  it('reuses the same key and snapshot after a timed-out lease', async () => {
    const first = await claim();
    await db.exec(`update artist_pay_payouts set lease_until = now() - interval '1 minute'`);
    const second = await claim();
    expect(second.payout.idempotency_key).toBe(first.payout.idempotency_key);
    expect(second.lease_token).not.toBe(first.lease_token);
    await expect(finish(first.lease_token)).rejects.toThrow('payout_lease_lost');
  });
  it('unknown network outcome permits only a same-key retry', async () => {
    const first = await claim();
    const unknown = await finish(first.lease_token, { error: 'network_unconfirmed' });
    expect(unknown.status).toBe('unknown');
    const second = await claim();
    expect(second.payout.idempotency_key).toBe(first.payout.idempotency_key);
  });
  it.each(['false', 'null'])('W9 %s blocks creation, not approval', async (value) => {
    await db.exec(`update contact_tax_profiles set w9_on_file = ${value}`);
    await expect(claim()).rejects.toThrow('w9_required');
    expect((await db.query('select status from artist_pay_requests')).rows[0].status).toBe('approved');
    expect((await db.query('select * from artist_pay_payouts')).rows).toHaveLength(0);
  });
  it('missing W9 row fails closed', async () => {
    await db.exec('delete from contact_tax_profiles');
    await expect(claim()).rejects.toThrow('w9_required');
  });
  it('blocks unapproved requests and missing recipients', async () => {
    await db.exec(`update artist_pay_requests set status = 'pending_review'`);
    await expect(claim()).rejects.toThrow('request_not_approved');
    await db.exec(`update artist_pay_requests set status = 'approved'; delete from contact_payout_profiles`);
    await expect(claim()).rejects.toThrow('recipient_required');
  });
  it('rolls back creation if the confirmed amount or recipient changed', async () => {
    await expect(claim({ amount: 15001 })).rejects.toThrow('confirmation_changed');
    await expect(claim({ recipientId: account })).rejects.toThrow('confirmation_changed');
    expect((await db.query('select * from artist_pay_payouts')).rows).toHaveLength(0);
  });
  it('does not call again after a request ID is recorded', async () => {
    const first = await claim();
    await finish(first.lease_token);
    expect((await claim()).skip).toBe(true);
    expect((await db.query('select * from artist_pay_payouts')).rows).toHaveLength(1);
  });
  it('refresh can proceed after W9 removal and does not mark paid', async () => {
    const first = await claim();
    await finish(first.lease_token);
    await db.exec('delete from contact_tax_profiles');
    const refresh = await claim({ refresh: true });
    expect((await finish(refresh.lease_token, { status: 'approved' })).status).toBe('approved');
    expect((await db.query('select status from artist_pay_requests')).rows[0].status).toBe('approved');
    expect((await db.query('select status from event_bookings')).rows[0].status).toBe('approved');
  });
  it('blocks recipient changes while submission is unresolved', async () => {
    await claim();
    await expect(db.query('select link_artist_mercury_recipient($1,$2,$3)', [contact, account, actor])).rejects.toThrow('payout_in_progress');
  });
  it('blocks environment drift even on a same-key retry', async () => {
    const first = await claim();
    await finish(first.lease_token, { error: 'network_unconfirmed' });
    await expect(claim({ mode: 'production' })).rejects.toThrow('mercury_config_changed');
  });
  it('rejects terminal-state regression', async () => {
    const first = await claim();
    await finish(first.lease_token, { status: 'approved' });
    const second = await claim({ refresh: true });
    await expect(finish(second.lease_token)).rejects.toThrow('mercury_status_conflict');
  });
  it('does not allow cancelled or rejected requests to create a replacement', async () => {
    const first = await claim();
    await finish(first.lease_token, { status: 'rejected' });
    expect((await claim()).skip).toBe(true);
  });
  it('writes durable audit entries without raw provider data', async () => {
    const first = await claim();
    await finish(first.lease_token);
    const audit = (await db.query('select action, details from artist_pay_audit_log')).rows;
    expect(audit.map((r) => r.action)).toEqual(['mercury_submission_started', 'mercury_status_updated']);
    expect(JSON.stringify(audit)).not.toMatch(/routingNumber|accountNumber/);
  });
  it('denies direct table access and RPC execution to anon and authenticated', async () => {
    const result = await db.query(`
      select role_name,
        has_table_privilege(role_name, 'contact_payout_profiles', 'SELECT') as profile_read,
        has_table_privilege(role_name, 'artist_pay_payouts', 'INSERT') as payout_write,
        has_function_privilege(role_name, 'claim_artist_mercury_payout(uuid,uuid,uuid,text,boolean,uuid,integer)', 'EXECUTE') as claim
      from (values ('anon'), ('authenticated')) as roles(role_name)
    `);
    for (const row of result.rows) expect(row).toMatchObject({ profile_read: false, payout_write: false, claim: false });
    expect((await db.query(`select has_function_privilege('anon', 'partner_bookings()', 'EXECUTE') as allowed`)).rows[0].allowed).toBe(false);
  });
});
