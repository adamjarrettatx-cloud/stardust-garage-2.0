import test from 'node:test';
import assert from 'node:assert/strict';
import { accountLegalName } from '../lib/account-legal-name.js';
import { readFileSync } from 'node:fs';
const db = (account,member,error) => ({from(table){const q={select:()=>q,eq:()=>q,
  maybeSingle:async()=>({data:table==='free_accounts'?account:member,error})};return q;}});
test('a provider-only identity is incomplete; stored account or member legal name is required',async()=>{
  assert.equal((await accountLegalName(db(null,null),'user')).complete,false);
  assert.equal((await accountLegalName(db({full_name:'Single'},null),'user')).complete,false);
  assert.equal((await accountLegalName(db({full_name:'Jane Doe'},null),'user')).complete,true);
  assert.equal((await accountLegalName(db(null,{full_name:'Jane Doe'}),'user')).complete,true);
});
test('canonical account name wins and database failures do not become profile-complete',async()=>{
  assert.equal((await accountLegalName(db({full_name:'Corrected Name'},{full_name:'Old Alias'}),'user')).fullName,'Corrected Name');
  await assert.rejects(accountLegalName(db(null,null,{code:'offline'}),'user'));
});
test('checkout validates the stored name before creating inventory holds or Stripe sessions',()=>{
  const src=readFileSync(new URL('../app/api/tickets/hold/route.js',import.meta.url),'utf8');
  const gate=src.indexOf('if (!legalProfile.complete)');
  assert.ok(gate>0);
  assert.ok(gate<src.indexOf(".rpc('create_ticket_hold'"));
  assert.ok(gate<src.indexOf('await createTicketCheckoutSession('));
  assert.match(src,/buyerName: legalProfile\.fullName/);
});
