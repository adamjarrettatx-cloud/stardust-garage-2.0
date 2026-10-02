import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read=p=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
test('trial preview remains advisory; redemption is transaction-only',()=>{
  const route=read('app/api/capacity/trial-pass/scan/route.js');
  assert.match(route,/linked_ticket:linkedTicket.ticket/);
  assert.match(route,/ticketCode:body.ticket_code/);
  assert.doesNotMatch(route,/\.from\('tickets'\)/);
});
test('transaction selects event-matching paid orders and activates only with admission',()=>{
  const sql=read('supabase/migrations/20261002011000_atomic_door_admission.sql');
  assert.match(sql,/ti.event_id=ds.event_id and ord.event_id=ds.event_id/);
  assert.match(sql,/ord.status in \('paid','partial_refund'\)/);
  assert.match(sql,/where id=p_subject and activated_at is null/);
  assert.match(sql,/for update of ti,ord/);
  assert.match(sql,/pg_advisory_xact_lock/);
});
