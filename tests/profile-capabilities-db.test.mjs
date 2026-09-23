import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('database enforces profile capabilities, event ownership, studio tiers and aggregate-only sales', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role authenticated; create role anon;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create table contacts(id uuid primary key,contact_type text[]);
      create table partner_profiles(user_id uuid,contact_id uuid,is_active boolean);
      create table team_members(user_id uuid,role text);
      create table member_profiles(user_id uuid,is_active boolean,subscription_status text,subscription_plan text);
      create table events(id uuid primary key,contact_id uuid,title text,event_date date,event_time text,image_url text,status text,ticketing_mode text);
      create table event_bookings(id uuid,contact_id uuid,event_id uuid,status text);
      create table artist_pay_requests(id uuid,contact_id uuid);
      create table event_guestlist_grants(id uuid,contact_id uuid,event_id uuid);
      create table document_contracts(id uuid,contact_id uuid,collective_contact_id uuid,event_id uuid,status text);
      create table contract_notifications(id uuid,contact_id uuid);
      create table studio_bookings(id uuid,user_id uuid);
      create table orders(id uuid,event_id uuid,status text,total_cents bigint,refunded_cents bigint,currency text,checkout_kind text,buyer_email text);
      create table tickets(id uuid,order_id uuid,event_id uuid,status text,qr_secret text);
      create table tt_discovered_events(local_event_id uuid,status text,currency text,tickets_sold int,orders_count int,gross_cents bigint,fees_cents bigint,net_cents bigint,fetched_at timestamptz);
      create function partner_contact_id() returns uuid language sql stable security definer set search_path=public as
        $$ select contact_id from partner_profiles where user_id=auth.uid() and is_active limit 1 $$;
      create function is_team() returns boolean language sql stable security definer set search_path=public as
        $$ select exists(select 1 from team_members where user_id=auth.uid() and role in ('admin','team')) $$;
      create function is_admin() returns boolean language sql stable security definer set search_path=public as
        $$ select exists(select 1 from team_members where user_id=auth.uid() and role='admin') $$;
      create function partner_bookings() returns setof event_bookings language sql stable security definer as
        $$ select b.* from event_bookings b where b.contact_id = public.partner_contact_id() $$;
      create function partner_contracts() returns setof document_contracts language sql stable security definer as
        $$ select c.* from document_contracts c where c.contact_id = public.partner_contact_id() and c.status <> 'draft' $$;
      create function partner_grants() returns setof event_guestlist_grants language sql stable security definer as
        $$ select g.* from event_guestlist_grants g where g.contact_id = public.partner_contact_id() $$;
      grant usage on schema public,auth to authenticated;
      grant select,insert on all tables in schema public to authenticated;
      alter table event_bookings enable row level security;
      create policy own on event_bookings for select to authenticated using(contact_id=partner_contact_id());
      alter table artist_pay_requests enable row level security;
      create policy own on artist_pay_requests for select to authenticated using(contact_id=partner_contact_id());
      alter table event_guestlist_grants enable row level security;
      create policy own on event_guestlist_grants for select to authenticated using(contact_id=partner_contact_id());
      alter table contract_notifications enable row level security;
      create policy own on contract_notifications for all to authenticated using(contact_id=partner_contact_id()) with check(contact_id=partner_contact_id());
      alter table studio_bookings enable row level security;
      create policy own on studio_bookings for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
      insert into contacts values('${uuid(1)}',array['promoter']),('${uuid(2)}',array['organization']);
      insert into partner_profiles values('${uuid(11)}','${uuid(1)}',true),('${uuid(12)}','${uuid(2)}',true);
      insert into events values('${uuid(21)}','${uuid(1)}','Owned event','2099-01-01','9pm',null,'published','internal'),
        ('${uuid(22)}','${uuid(2)}','Other event','2020-01-01',null,null,'published','internal');
      insert into event_bookings values('${uuid(31)}','${uuid(1)}','${uuid(21)}','confirmed');
      insert into artist_pay_requests values('${uuid(32)}','${uuid(1)}');
      insert into event_guestlist_grants values('${uuid(33)}','${uuid(1)}','${uuid(21)}');
      insert into document_contracts values('${uuid(34)}','${uuid(1)}',null,'${uuid(21)}','signed');
      insert into contract_notifications values('${uuid(35)}','${uuid(1)}');
      insert into member_profiles values('${uuid(11)}',true,'active','weekender');
      insert into orders values
        ('${uuid(41)}','${uuid(21)}','partial_refund',10000,2000,'usd','paid','secret@example.invalid'),
        ('${uuid(42)}','${uuid(21)}','paid',5000,0,'usd','comp','secret@example.invalid'),
        ('${uuid(43)}','${uuid(21)}','pending',80000,0,'usd','paid','secret@example.invalid'),
        ('${uuid(44)}','${uuid(21)}','paid',3000,0,'eur','paid','secret@example.invalid');
      insert into tickets values
        ('${uuid(51)}','${uuid(41)}','${uuid(21)}','used','secret-code'),
        ('${uuid(52)}','${uuid(41)}','${uuid(21)}','valid','secret-code'),
        ('${uuid(53)}','${uuid(41)}','${uuid(21)}','refunded','secret-code'),
        ('${uuid(54)}','${uuid(42)}','${uuid(21)}','valid','secret-code'),
        ('${uuid(55)}','${uuid(43)}','${uuid(21)}','valid','secret-code');
      insert into tt_discovered_events values('${uuid(21)}','ok','USD',10,8,20000,500,19500,now());
    `);
    const migration = await readFile(new URL('../supabase/migrations/20260924_profile_capabilities_and_events.sql', import.meta.url), 'utf8');
    await db.exec(migration);
    await db.exec(migration); // Must be safe to retry.
    await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [uuid(11)]);
    const scalar = async (sql) => Object.values((await db.query(sql)).rows[0])[0];
    for (const [role, guest, pay, contracts, events] of [
      ['promoter', true, false, false, false], ['vendor', false, false, true, false],
      ['organization', true, false, true, true], ['collective', true, false, true, true],
      ['event_organizer', true, false, true, true], ['artist', true, true, true, false],
    ]) {
      await db.query(`update contacts set contact_type=$1 where id=$2`, [[role], uuid(1)]);
      for (const [cap, allowed] of Object.entries({ guestList: guest, pay, contracts, events })) {
        assert.equal(await scalar(`select partner_has_capability('${cap}')`), allowed, `${role}/${cap}`);
      }
      assert.equal((await db.query('select * from partner_bookings()')).rows.length, pay ? 1 : 0);
      assert.equal((await db.query('select * from partner_contracts()')).rows.length, contracts ? 1 : 0);
      assert.equal((await db.query('select * from partner_grants()')).rows.length, guest ? 1 : 0);
      await db.exec('set role authenticated');
      for (const [table, allowed] of [['event_bookings', pay], ['artist_pay_requests', pay], ['event_guestlist_grants', guest], ['contract_notifications', contracts]]) {
        assert.equal(Number(await scalar(`select count(*) from ${table}`)), allowed ? 1 : 0, `${role} direct ${table}`);
      }
      await db.exec('reset role');
    }
    await db.query(`update contacts set contact_type=array['organization'] where id=$1`, [uuid(1)]);
    assert.deepEqual((await db.query('select id from partner_my_events()')).rows.map(r => r.id), [uuid(21)]);
    await assert.rejects(db.query(`select partner_event_sales('${uuid(22)}')`), /Event not found/);
    const report = await scalar(`select partner_event_sales('${uuid(21)}')`);
    assert.equal(report.internal.tickets_issued, 4);
    assert.equal(report.internal.tickets_valid, 3);
    assert.equal(report.internal.tickets_used, 1);
    assert.equal(report.internal.complimentary_tickets, 1);
    assert.equal(report.internal.currencies.length, 2);
    const usd = report.internal.currencies.find(r => r.currency === 'USD');
    assert.deepEqual(usd, { currency: 'USD', paid_orders: 1, gross_collected_cents: 10000, refunded_cents: 2000, net_collected_cents: 8000 });
    assert.equal(report.ticket_tailor[0].gross_cents, 20000);
    assert.doesNotMatch(JSON.stringify(report), /secret@example|secret-code|buyer_email|qr_secret/);
    for (const plan of ['weekender', 'cowork', 'iykyk']) {
      await db.query('update member_profiles set subscription_plan=$1', [plan]);
      assert.equal(await scalar('select member_can_book_studio()'), plan === 'iykyk');
      await db.exec('set role authenticated');
      const insert = () => db.query(`insert into studio_bookings values('${uuid(61)}','${uuid(11)}')`);
      if (plan === 'iykyk') await insert();
      else await assert.rejects(insert(), /row-level security/);
      await db.exec('reset role');
    }
    await db.exec('update member_profiles set is_active=false');
    assert.equal(await scalar('select member_can_book_studio()'), false);
    await db.query(`insert into team_members values($1,'front_desk')`, [uuid(11)]);
    assert.equal(await scalar(`select partner_has_capability('events')`), false);
    await db.exec('delete from team_members; update partner_profiles set is_active=false');
    assert.equal(await scalar(`select partner_has_capability('events')`), false);
    for (const signature of ['partner_event_sales(uuid)', 'partner_my_events()', 'partner_has_event(uuid)', 'member_can_book_studio()']) {
      assert.equal(await scalar(`select has_function_privilege('anon','public.${signature}','EXECUTE')`), false);
    }
  } finally { await db.close(); }
});
