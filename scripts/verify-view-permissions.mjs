// Acceptance helper for the isolated branch. The caller supplies temporary
// fixture sessions and personas; credentials are never committed.
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { PREVIEW_PROJECT_REF } from '../lib/view-portal/config.js';
import { VIEW_PERSONAS as personas } from '../lib/view-portal/personas.js';
if (process.env.VIEW_PORTAL_MODE !== 'sandbox'
  || process.env.NEXT_PUBLIC_SUPABASE_URL !== `https://${PREVIEW_PROJECT_REF}.supabase.co`) {
  throw new Error('Refusing permission verification outside the isolated View Portal.');
}
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const sessions = JSON.parse(fs.readFileSync(process.env.VIEW_PORTAL_TEST_SESSIONS, 'utf8'));
if (!key || sessions.length !== personas.length
  || new Set(sessions.map(s => s.persona)).size !== personas.length
  || sessions.some(s => !personas.some(p => p.id === s.persona))) {
  throw new Error('Exactly one authenticated session per fixed fixture persona is required.');
}
const report=[];
function check(id,name,ok,actual){report.push({persona:id,test:name,passed:!!ok,actual});}
for(const s of sessions){
  const p=personas.find(x=>x.id===s.persona);
  const staff=['team','admin'].includes(p.teamRole),admin=p.teamRole==='admin';
  const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,key,{global:{headers:{Authorization:`Bearer ${s.accessToken}`}},auth:{persistSession:false,autoRefreshToken:false}});
  const identity = await db.auth.getUser(s.accessToken);
  if (identity.error || identity.data.user?.id !== s.userId
    || identity.data.user?.app_metadata?.view_portal_persona !== p.id) {
    throw new Error(`Unverified synthetic identity: ${p.id}`);
  }
  for(const [table,expected] of [
    ['free_accounts',staff?20:1],
    ['orders',admin?20:1],['tickets',admin?20:1],
    ['team_events',staff||p.teamRole==='calendar_viewer'?1:0],
    ['events',staff?3:1],
    ['member_profiles',admin?4:p.plan?1:0],
    ['partner_profiles',admin?10:p.partner?1:0],
  ]){
    const r=await db.from(table).select('id');
    check(p.id,`${table} visible count`,!r.error&&r.data.length===expected,r.error?.message||r.data.length);
  }
  for(const rpc of ['partner_bookings','partner_contracts','partner_grants']){
    const r=await db.rpc(rpc);
    const expected=p.partner&&!p.partnerState?1:0;
    check(p.id,`${rpc} own assignments`,!r.error&&r.data.length===expected,r.error?.message||r.data.length);
  }
  const owner=await db.rpc('is_owner');
  check(p.id,'never owner',!owner.error&&owner.data===false,owner.error?.message||owner.data);
  const registry=await db.from('view_portal_personas').select('persona_id');
  check(p.id,'cannot read registry',!!registry.error,registry.error?.code||registry.data?.length);
  const registryWrite=await db.from('view_portal_personas').update({ready:true}).eq('persona_id',p.id).select();
  check(p.id,'cannot enable preview',!!registryWrite.error,registryWrite.error?.code);
  const ownerProfile=await db.from('free_accounts').select('user_id').eq('user_id',sessions.find(x=>x.persona==='free').userId);
  check(p.id,'cross-account profile boundary',!ownerProfile.error&&ownerProfile.data.length===(staff||p.id==='free'?1:0),ownerProfile.error?.code||ownerProfile.data.length);
  if(p.partner){
    const activation=await db.from('partner_profiles').update({is_active:true}).eq('user_id',s.userId).select('id');
    check(p.id,'cannot self-activate partner',!!activation.error,activation.error?.code);
  }
  console.log(p.id,`${report.filter(x=>x.persona===p.id&&x.passed).length}/${report.filter(x=>x.persona===p.id).length} passed`);
}
if (process.env.VIEW_PORTAL_TEST_REPORT) {
  fs.writeFileSync(process.env.VIEW_PORTAL_TEST_REPORT, JSON.stringify(report, null, 2), { mode: 0o600 });
}
const failed=report.filter(x=>!x.passed);
console.log(JSON.stringify({passed:report.length-failed.length,total:report.length,failed},null,2));
if(failed.length)process.exitCode=1;
