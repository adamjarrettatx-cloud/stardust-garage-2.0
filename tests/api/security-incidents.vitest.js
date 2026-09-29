import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/capacity/security/route';
import { validateIncident } from '@/lib/capacity/security-policy';
const state=vi.hoisted(()=>({gate:{},db:null,identity:null,roster:null,access:null}));
vi.mock('@/lib/auth-helpers',()=>({requireFrontDeskOrTeam:async()=>state.gate}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:()=>state.db}));
vi.mock('@/lib/rate-limit',()=>({rateLimit:()=>({ok:true})}));
vi.mock('@/lib/capacity/access-restrictions',()=>({resolveAccessIdentity:async()=>state.identity,accessStatus:async()=>state.access}));
vi.mock('@/lib/capacity/security-profile',()=>({loadSecurityProfile:async()=>({full_name:'Real Name',photo_url:'https://example.invalid/photo'})}));
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const subject={kind:'member',id:id(1)};
const input={action:'record',incident_action:'ban',request_id:id(10),subject,category:'altercation',note:'Observed a physical altercation.',identity_confirmed:true,restriction_confirmed:true};
const request=body=>new Request('https://example.invalid/api/capacity/security',{method:'POST',body:JSON.stringify(body)});
function database(member=null,pass=null,fail=false){
  const db={rpc:vi.fn(async()=>({data:id(99)})),from:vi.fn(table=>{
    const q={select:()=>q,eq:()=>q,maybeSingle:async()=>fail?{error:{message:'offline'}}:{data:table==='member_identity_tokens'?member:pass}};
    return q;
  })};return db;
}
beforeEach(()=>{
  state.gate={unauthorized:false,user:{id:id(4)}};state.db=database();
  state.identity={subject_key:`member:${id(1)}`,identity_keys:[`member:${id(1)}`],match_keys:['name:real name'],full_name:'Real Name'};
  state.roster={people:[{identityKeys:[`member:${id(1)}`],wire:{full_name:'Real Name',photo_url:'https://example.invalid/photo'}}]};
  state.access={status:'clear',matches:[],incidents:[]};
});
describe('security incident boundary',()=>{
  it('rejects anonymous users before database reads',async()=>{
    state.gate={unauthorized:true};
    expect((await POST(request(input))).status).toBe(401);expect(state.db.from).not.toHaveBeenCalled();expect(state.db.rpc).not.toHaveBeenCalled();
  });
  it('requires identity and restriction confirmation, factual note, valid category, request id',async()=>{
    for(const change of [{identity_confirmed:false},{restriction_confirmed:false},{note:' '},{category:'__proto__'},{request_id:'bad'},{incident_action:'lift'}]){
      expect((await POST(request({...input,...change}))).status).toBe(400);
    }expect(state.db.rpc).not.toHaveBeenCalled();
  });
  it('strips forged actor/name/identity/event fields and invokes one atomic RPC',async()=>{
    expect((await POST(request({...input,actor_id:id(7),identity_keys:['forged'],full_name:'Forged',event_id:id(8)}))).status).toBe(200);
    const [name,args]=state.db.rpc.mock.calls[0];
    expect(name).toBe('record_security_incident');expect(args.p_actor).toBe(id(4));
    expect(args.p_data.identity_keys).toEqual([`member:${id(1)}`]);expect(args.p_data.full_name).toBe('Real Name');
    expect(args.p_data).not.toHaveProperty('event_id');
  });
  it('does not return success on RPC failure or revoked staff access',async()=>{
    state.db.rpc.mockResolvedValue({error:{code:'42501'}});
    expect((await POST(request(input))).status).toBe(403);
    state.db.rpc.mockResolvedValue({error:{code:'P0001'}});
    expect((await POST(request(input))).status).toBe(409);
  });
  it('lookup reads identity but writes no incident or admission',async()=>{
    state.db=database({member_profile_id:id(1),revoked_at:null});
    const res=await POST(request({action:'lookup',raw:'https://www.sdgatx.com/member/id/'+'a'.repeat(43)}));
    expect(res.status).toBe(200);expect((await res.json()).profile.full_name).toBe('Real Name');
    expect(state.db.rpc).not.toHaveBeenCalled();
  });
  it('revoked ambiguous token never falls through to a trial pass',async()=>{
    state.db=database({member_profile_id:id(1),revoked_at:'2026-01-01'},{id:id(2)});
    expect((await POST(request({action:'lookup',raw:'a'.repeat(43)}))).status).toBe(410);
    expect(state.db.from.mock.calls.map(x=>x[0])).toEqual(['member_identity_tokens']);
  });
  it('DB failure is not treated as a missing token',async()=>{
    state.db=database(null,{id:id(2)},true);
    expect((await POST(request({action:'lookup',raw:'a'.repeat(43)}))).status).toBe(503);
    expect(state.db.from).toHaveBeenCalledTimes(1);
  });
  it('falls back to trial only after a real member miss',async()=>{
    state.db=database(null,{id:id(2)});state.roster.people[0].identityKeys.push(`trial_pass:${id(2)}`);
    const response=await POST(request({action:'lookup',raw:'a'.repeat(43)}));
    expect(response.status).toBe(200);expect((await response.json()).subject).toEqual({kind:'trial_pass',id:id(2)});
  });
  it('rejects tickets rather than silently attaching an incident to the buyer',async()=>{
    const res=await POST(request({action:'lookup',raw:'SDGA-ABCD-ABCD-ABCD-ABCD-ABCD-ABCD'}));
    expect(res.status).toBe(400);expect(state.db.from).not.toHaveBeenCalled();
  });
  it('allows warnings without restriction confirmation but never without identity',()=>{
    const warning={...input,action:'warning',restriction_confirmed:false};
    expect(()=>validateIncident(warning)).not.toThrow();expect(()=>validateIncident({...warning,identity_confirmed:false})).toThrow();
  });
});
