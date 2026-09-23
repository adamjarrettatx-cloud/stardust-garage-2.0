import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const owner = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const order = '00000000-0000-4000-8000-000000000003';
const event = '00000000-0000-4000-8000-000000000004';
async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    insert into auth.users values('${owner}'),('${other}');
    create table orders(
      id uuid primary key, event_id uuid, status text, total_cents bigint, refunded_cents bigint default 0,
      tax_cents bigint default 0, refunded_tax_cents bigint default 0, stripe_payment_intent_id text,
      currency text default 'usd', refunded_at timestamptz, updated_at timestamptz
    );
    create table tickets(id uuid primary key default gen_random_uuid(), order_id uuid, status text, refunded_at timestamptz, updated_at timestamptz);
    create table ticket_audit_log(id uuid default gen_random_uuid(), event_id uuid, order_id uuid, actor_user_id uuid, actor_role text, action text, detail jsonb);
    insert into orders(id,event_id,status,total_cents,tax_cents,stripe_payment_intent_id) values('${order}','${event}','paid',10000,825,'pi_test');
    insert into tickets(order_id,status) values('${order}','valid'),('${order}','used');
  `);
  await db.exec(fs.readFileSync(new URL('../supabase/migrations/20260923_ticket_refund_requests.sql', import.meta.url), 'utf8'));
  return db;
}
async function draft(db, amount = 10000, expected = 0) {
  return (await db.query(`insert into ticket_refund_requests(order_id,actor_user_id,amount_cents,expected_refunded_cents,currency)
    values($1,$2,$3,$4,'usd') returning id`, [order, owner, amount, expected])).rows[0].id;
}
const claim = (db, id, actor = owner) => db.query('select claim_ticket_refund($1,$2) as result', [id, actor]);
const finish = (db, id, status = 'succeeded', ref = 're_test') =>
  db.query('select finish_ticket_refund($1,$2,$3,null) as result', [id, ref, status]);

test('SQL: full refund settles once, restores no admission, and denies client access', async () => {
  const db = await setup();
  try {
    const id = await draft(db);
    await assert.rejects(() => finish(db, id), /not been confirmed/);
    await assert.rejects(() => claim(db, id, other), /another administrator/);
    await claim(db, id);
    await assert.rejects(() => claim(db, id), /already processing/);
    await finish(db, id);
    await finish(db, id);
    let row = (await db.query('select * from orders')).rows[0];
    assert.equal(Number(row.refunded_cents), 10000);
    assert.equal(Number(row.refunded_tax_cents), 825);
    assert.equal(row.status, 'refunded');
    assert.deepEqual((await db.query('select status from tickets order by status')).rows.map((r) => r.status), ['refunded', 'used']);
    assert.equal(Number((await db.query("select count(*) as n from ticket_audit_log where action='refund.succeeded'")).rows[0].n), 1);
    await finish(db, id, 'pending');
    assert.equal((await db.query('select status from ticket_refund_requests')).rows[0].status, 'succeeded');
    await finish(db, id, 'failed');
    row = (await db.query('select * from orders')).rows[0];
    assert.equal(Number(row.refunded_cents), 0);
    assert.equal(Number(row.refunded_tax_cents), 0);
    assert.equal(row.status, 'paid');
    assert.deepEqual((await db.query('select status from tickets order by status')).rows.map((r) => r.status), ['refunded', 'used']);
    await finish(db, id, 'succeeded'); // stale success must not reapply money
    assert.equal(Number((await db.query('select refunded_cents from orders')).rows[0].refunded_cents), 0);
    assert.equal((await db.query("select has_table_privilege('authenticated','ticket_refund_requests','select') as allowed")).rows[0].allowed, false);
    assert.equal((await db.query("select has_function_privilege('authenticated','claim_ticket_refund(uuid,uuid)','execute') as allowed")).rows[0].allowed, false);
  } finally { await db.close(); }
});

test('SQL: distinct partial refunds of the same amount settle separately; concurrent drafts cannot both claim', async () => {
  const db = await setup();
  try {
    const first = await draft(db, 2500);
    const competing = await draft(db, 2500);
    await claim(db, first);
    await assert.rejects(() => claim(db, competing), /Another refund is in progress/);
    await finish(db, first, 'pending', 're_first');
    assert.equal(Number((await db.query('select refunded_cents from orders')).rows[0].refunded_cents), 0);
    await finish(db, first, 'succeeded', 're_first');
    await assert.rejects(() => claim(db, competing), /balance changed/);
    const second = await draft(db, 2500, 2500);
    await claim(db, second); await finish(db, second, 'succeeded', 're_second');
    const row = (await db.query('select * from orders')).rows[0];
    assert.equal(Number(row.refunded_cents), 5000);
    assert.equal(row.status, 'partial_refund');
    assert.equal((await db.query("select count(*)::int n from tickets where status='valid'")).rows[0].n, 1);
  } finally { await db.close(); }
});

test('SQL: expired reviews, over-refunds, missing payments and mismatched references fail closed', async () => {
  const db = await setup();
  try {
    const expired = await draft(db);
    await db.query("update ticket_refund_requests set created_at=now()-interval '16 minutes' where id=$1", [expired]);
    await assert.rejects(() => claim(db, expired), /Review expired/);
    const excessive = await draft(db, 10001);
    await assert.rejects(() => claim(db, excessive), /balance changed/);
    const valid = await draft(db);
    await db.query("update orders set stripe_payment_intent_id=null");
    await assert.rejects(() => claim(db, valid), /not refundable/);
    await db.query("update orders set stripe_payment_intent_id='pi_test'");
    await claim(db, valid);
    await finish(db, valid, 'pending', 're_correct');
    await assert.rejects(() => finish(db, valid, 'succeeded', 're_wrong'), /reference mismatch/);
  } finally { await db.close(); }
});
