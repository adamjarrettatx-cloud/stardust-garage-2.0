import test from 'node:test';
import assert from 'node:assert/strict';
import { doorEventWindow, selectDoorEvents, safePublicUrl } from '../lib/events/door-events.js';
import { loadDoorEvents, doorTicketStatus, DOOR_CACHE_HEADERS } from '../lib/events/door-events-server.js';

const event = (extra = {}) => ({
  id: 'e1', title: 'Test Event', slug: 'test-event', status: 'published', visibility: 'public',
  event_date: '2026-10-02', event_time: '10PM', event_end_time: '2AM',
  ticketing_mode: 'internal', image_url: 'https://example.com/art.png', ...extra,
});
const at = s => new Date(s);
const now = at('2026-10-03T04:00:00Z'); // Friday 11 PM CDT
const select = (rows, time = now, session = null) => selectDoorEvents(rows, session, time);

test('one-hour lead uses Chicago, inclusive open and exclusive end', () => {
  const e = event();
  assert.deepEqual(doorEventWindow(e), {
    opensAt: +at('2026-10-03T02:00:00Z'), startsAt: +at('2026-10-03T03:00:00Z'), endsAt: +at('2026-10-03T07:00:00Z'),
  });
  for (const [instant, count] of [
    ['2026-10-03T01:59:59Z', 0], ['2026-10-03T02:00:00Z', 1],
    ['2026-10-03T06:59:59Z', 1], ['2026-10-03T07:00:00Z', 0],
  ]) assert.equal(select([e], at(instant)).events.length, count);
});
test('Friday event survives midnight rather than selecting Saturday night', () => {
  const result = select([event(), event({id:'e2', event_date:'2026-10-03'})], at('2026-10-03T06:00:00Z'));
  assert.equal(result.state, 'current'); assert.equal(result.events[0].id, 'e1');
});
test('before open and after end never fall through to another night', () => {
  assert.equal(select([event()], at('2026-10-02T21:00:00Z')).state, 'empty');
  assert.equal(select([event(), event({id:'e2',event_date:'2026-10-03'})], at('2026-10-03T09:00:00Z')).state, 'empty');
});
test('missing end reuses six/eight hour existing listing cutoffs', () => {
  assert.equal(doorEventWindow(event({event_end_time:null})).endsAt, +at('2026-10-03T09:00:00Z'));
  assert.equal(doorEventWindow(event({event_time:'6:30PM - LATE',event_end_time:null})).endsAt, +at('2026-10-03T07:30:00Z'));
});
test('DST: spring and fall overnight windows follow Chicago wall clocks', () => {
  const fall = doorEventWindow(event({event_date:'2026-10-31',event_end_time:'2AM'}));
  assert.equal(fall.startsAt, +at('2026-11-01T03:00:00Z'));
  assert.equal(fall.endsAt, +at('2026-11-01T08:00:00Z'));
  const spring = doorEventWindow(event({event_date:'2026-03-07',event_end_time:'4AM'}));
  assert.equal(spring.startsAt, +at('2026-03-08T04:00:00Z'));
  assert.equal(spring.endsAt, +at('2026-03-08T09:00:00Z'));
});
test('malformed/missing dates and unparseable starts are never guessed', () => {
  for (const extra of [{event_date:'2026-02-30'}, {event_date:'bad'}, {event_time:'TBD'}, {event_time:null}])
    assert.equal(select([event(extra)]).state, 'empty');
});
test('only published public rows can appear, even with a matching staff session', () => {
  for (const extra of [{status:'draft'}, {status:'cancelled'}, {visibility:'unlisted'}, {visibility:'internal'}, {visibility:null}, {slug:null}]) {
    assert.equal(select([event(extra)], now, {event_id:'e1',opened_at:'2026-10-03T03:00:00Z'}).events.length, 0);
  }
});
test('overlap requires explicit choice unless there is a valid current staff session', () => {
  const rows = [event(),event({id:'e2',slug:'second'})];
  assert.equal(select(rows).state, 'choose');
  const result = select(rows, now, {event_id:'e2',opened_at:'2026-10-03T02:30:00Z',closed_at:null});
  assert.equal(result.state,'current'); assert.equal(result.events[0].id,'e2');
  for (const session of [
    {event_id:'e2',opened_at:'2026-10-02T02:30:00Z'},
    {event_id:'e2',opened_at:'2026-10-04T02:30:00Z'},
    {event_id:'e2',opened_at:'bad'},
    {event_id:'e2',opened_at:'2026-10-03T02:30:00Z',closed_at:'2026-10-03T03:00:00Z'},
    {event_id:'private',opened_at:'2026-10-03T02:30:00Z'},
  ]) assert.equal(select(rows, now, session).state,'choose');
});
test('public response is explicitly projected and checkout remains event-specific', () => {
  const result = select([event({share_token:'secret-capability',email:'private@example.com',slug:'a/b?x',ticket_url:'javascript:alert(1)'})]);
  const wire = JSON.stringify(result);
  for (const secret of ['secret-capability','private@example.com','opened_at','share_token']) assert.ok(!wire.includes(secret));
  assert.equal(result.events[0].href,'/events/a%2Fb%3Fx');
  assert.equal(result.events[0].ticket_url,null);
  assert.equal(safePublicUrl('https://user:password@example.com'),null);
});
test('server supplies the next activation boundary', () => {
  const result = select([event()], at('2026-10-03T01:00:00Z'));
  assert.equal(result.next_change_at,'2026-10-03T02:00:00.000Z');
  assert.equal(select([event()], at('2026-10-03T02:30:00Z')).next_change_at,'2026-10-03T03:00:00.000Z');
});

const product = {id:'p1',event_id:'e1',is_active:true,sales_start_at:null,sales_end_at:null};
const tier = {id:'t1',product_id:'p1',status:'active',is_active:true,quantity:null};
test('ticket states respect stock, timing, disabled products and code-gated options', () => {
  assert.equal(doorTicketStatus([product],[tier],[],now),'available');
  assert.equal(doorTicketStatus([product],[tier],[{product_id:'p1',capacity:null}],now),'available');
  assert.equal(doorTicketStatus([product],[tier],[{product_id:'p1',capacity:10,sold:9,reserved:1}],now),'sold_out');
  assert.equal(doorTicketStatus([product],[{...tier,quantity:1,sold_count:1}],[],now),'sold_out');
  assert.equal(doorTicketStatus([product],[{...tier,status:'sold_out'}],[],now),'sold_out');
  assert.equal(doorTicketStatus([product],[{...tier,status:'access_code'}],[],now),'options');
  assert.equal(doorTicketStatus([{...product,sales_end_at:'2026-10-03T03:00:00Z'}],[tier],[],now),'closed');
  assert.equal(doorTicketStatus([{...product,sales_start_at:'2026-10-03T05:00:00Z'}],[tier],[],now),'options');
  assert.equal(doorTicketStatus([{...product,is_active:false}],[tier],[],now),'unavailable');
  assert.equal(doorTicketStatus([],[],[],now),'unavailable');
});
test('a later active tier progresses normally without exposing its prices', () => {
  assert.equal(doorTicketStatus([product],[{...tier,quantity:1,sold_count:1},{...tier,id:'t2',display_order:1}],[],now),'available');
});

function database(overrides = {}, failed = null) {
  const tables = {events:[event()],door_sessions:[],ticket_products:[product],ticket_price_tiers:[tier],ticket_inventory:[],...overrides};
  const calls=[];
  return {calls,from(table) {
    let filters=[],limit=Infinity;
    const b={
      select: columns => {calls.push({table,columns});return b},
      eq:(k,v)=>{filters.push(r=>r[k]===v);return b},
      is:(k,v)=>{filters.push(r=>(r[k]??null)===v);return b},
      in:(k,vs)=>{filters.push(r=>vs.includes(r[k]));return b},
      gte:(k,v)=>{filters.push(r=>r[k]>=v);return b},
      lte:(k,v)=>{filters.push(r=>r[k]<=v);return b},
      order:()=>b,limit:n=>{limit=n;return b},
      then:(resolve,reject)=>Promise.resolve(table===failed?{error:{message:'database detail'}}:
        {data:tables[table].filter(r=>filters.every(f=>f(r))).slice(0,limit)}).then(resolve,reject),
    };return b;
  }};
}
test('loader returns public status but no inventory, codes or session fields', async () => {
  const result=await loadDoorEvents(database(),{now,ticketingEnabled:true});
  assert.equal(result.events[0].ticket_status,'available');
  for(const key of ['capacity','quantity','access_codes','opened_at','sales_end_at'])assert.ok(!JSON.stringify(result).includes(key));
  assert.match(DOOR_CACHE_HEADERS['Cache-Control'],/no-store/);
});
test('empty window avoids inventory and staff-session queries',async()=>{
  const db=database();
  assert.equal((await loadDoorEvents(db,{now:at('2026-10-01T12:00:00Z')})).state,'empty');
  assert.equal(db.calls.length,1);
});
test('DB failure fails closed and feature flag never enables purchasing',async()=>{
  await assert.rejects(loadDoorEvents(database({},'events'),{now}),/lookup unavailable/);
  for(const table of ['ticket_products','ticket_price_tiers','ticket_inventory']){
    const result=await loadDoorEvents(database({},table),{now,ticketingEnabled:true});
    assert.equal(result.events[0].ticket_status,'unavailable');
  }
  assert.equal((await loadDoorEvents(database(),{now,ticketingEnabled:false})).events[0].ticket_status,'unavailable');
});
test('overlap staff query failure falls back to choice, not random selection',async()=>{
  const db=database({events:[event(),event({id:'e2',slug:'second'})]},'door_sessions');
  assert.equal((await loadDoorEvents(db,{now})).state,'choose');
});
test('free and safe external events do not depend on internal ticketing flag',async()=>{
  const db=database({events:[event({ticketing_mode:'none'})]});
  assert.equal((await loadDoorEvents(db,{now})).events[0].ticket_status,'free');
  const external=database({events:[event({ticketing_mode:'external',ticket_url:'https://example.com/tickets'})]});
  assert.equal((await loadDoorEvents(external,{now})).events[0].ticket_status,'external');
});
