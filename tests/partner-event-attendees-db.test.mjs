import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('organizer attendee list returns names only, newest first, active tickets only', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role authenticated; create role anon;
      create function public.partner_has_event(p uuid) returns boolean language sql stable as
        $$ select p = '${uuid(21)}'::uuid $$;
      create table member_profiles(id uuid primary key,user_id uuid,full_name text,email text,phone text);
      create table orders(id uuid primary key,event_id uuid,status text,buyer_name text,buyer_email text,buyer_phone text,
        user_id uuid,member_profile_id uuid,paid_at timestamptz,created_at timestamptz default now(),stripe_payment_intent_id text);
      create table order_items(id uuid primary key,order_id uuid,product_name_snapshot text,tier_name_snapshot text);
      create table attendees(id uuid primary key,order_id uuid,ticket_id uuid,full_name text,email text,phone text);
      create table tickets(id uuid primary key,order_id uuid,order_item_id uuid,event_id uuid,seat_index int,status text,
        attendee_id uuid,ticket_code text);
      insert into member_profiles values('${uuid(61)}','${uuid(71)}','Profile Person','profile@example.invalid','+15125550100');
      insert into orders values
        ('${uuid(41)}','${uuid(21)}','paid','Ada Buyer','ada@example.invalid','+15125550111',null,null,'2026-10-01T10:00:00Z',now(),'pi_secret'),
        ('${uuid(42)}','${uuid(21)}','partial_refund','  ',  'blank@example.invalid',null,'${uuid(71)}','${uuid(61)}','2026-10-03T10:00:00Z',now(),'pi_secret'),
        ('${uuid(43)}','${uuid(21)}','pending','Pending Pat','pending@example.invalid',null,null,null,null,now(),null),
        ('${uuid(44)}','${uuid(21)}','refunded','Refunded Rae','refund@example.invalid',null,null,null,'2026-10-04T10:00:00Z',now(),null),
        ('${uuid(45)}','${uuid(22)}','paid','Other Event','other@example.invalid',null,null,null,'2026-10-05T10:00:00Z',now(),null),
        ('${uuid(46)}','${uuid(21)}','paid',null,'noname@example.invalid',null,null,null,'2026-10-02T10:00:00Z',now(),null);
      insert into order_items values
        ('${uuid(81)}','${uuid(41)}','Tickets','Early Bird'),('${uuid(82)}','${uuid(42)}','Tickets',null),
        ('${uuid(83)}','${uuid(43)}','Tickets','Tier 1'),('${uuid(84)}','${uuid(44)}','Tickets','Tier 1'),
        ('${uuid(85)}','${uuid(45)}','Tickets','Tier 1'),('${uuid(86)}','${uuid(46)}',null,null);
      insert into attendees values('${uuid(91)}','${uuid(41)}','${uuid(52)}','Grace Guest','grace@example.invalid','+15125550122');
      insert into tickets values
        ('${uuid(51)}','${uuid(41)}','${uuid(81)}','${uuid(21)}',0,'used',null,'secret-code'),
        ('${uuid(52)}','${uuid(41)}','${uuid(81)}','${uuid(21)}',1,'valid',null,'secret-code'),
        ('${uuid(53)}','${uuid(41)}','${uuid(81)}','${uuid(21)}',2,'refunded',null,'secret-code'),
        ('${uuid(54)}','${uuid(42)}','${uuid(82)}','${uuid(21)}',0,'valid',null,'secret-code'),
        ('${uuid(55)}','${uuid(43)}','${uuid(83)}','${uuid(21)}',0,'valid',null,'secret-code'),
        ('${uuid(56)}','${uuid(44)}','${uuid(84)}','${uuid(21)}',0,'refunded',null,'secret-code'),
        ('${uuid(57)}','${uuid(45)}','${uuid(85)}','${uuid(22)}',0,'valid',null,'secret-code'),
        ('${uuid(58)}','${uuid(46)}','${uuid(86)}','${uuid(21)}',0,'valid',null,'secret-code');
    `);
    const migration = await readFile(new URL('../supabase/migrations/20261013180000_partner_event_attendees.sql', import.meta.url), 'utf8');
    await db.exec(migration);
    await db.exec(migration); // Must be safe to retry.
    await assert.rejects(db.query(`select partner_event_attendees('${uuid(22)}')`), /Event not found/);
    const report = Object.values((await db.query(`select partner_event_attendees('${uuid(21)}')`)).rows[0])[0];
    assert.deepEqual(report.attendees.map((r) => [r.name, r.purchased_by, r.ticket_type]), [
      ['Profile Person', null, 'Tickets'],
      ['Name not provided', null, 'Ticket'],
      ['Ada Buyer', null, 'Early Bird'],
      ['Grace Guest', 'Ada Buyer', 'Early Bird'],
    ]);
    for (const row of report.attendees) assert.deepEqual(Object.keys(row).sort(), ['name', 'purchased_at', 'purchased_by', 'ticket_type']);
    assert.doesNotMatch(JSON.stringify(report), /example\.invalid|\+1512|secret-code|pi_secret|00000000-0000/);
    assert.equal(Object.values((await db.query(`select has_function_privilege('anon','public.partner_event_attendees(uuid)','EXECUTE')`)).rows[0])[0], false);
  } finally { await db.close(); }
});
