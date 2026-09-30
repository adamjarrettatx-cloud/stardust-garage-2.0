import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/capacity/security/route';
import { validateIncident } from '@/lib/capacity/security-policy';
import { hashPassToken } from '@/lib/trial-pass';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import sharp from 'sharp';
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
function database(member=null,pass=null,fail=false,legacy=null){
  const db={rpc:vi.fn(async()=>({data:id(99)})),from:vi.fn(table=>{
    const q={select:vi.fn(()=>q),eq:vi.fn(()=>q),maybeSingle:async()=>fail?{error:{message:'offline'}}:{data:table==='member_identity_tokens'?member:table==='member_profiles'?legacy:pass}};
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
  it('resolves the native app current Trial Pass envelope by hash without admission writes',async()=>{
    const token='a'.repeat(43);
    state.db=database(null,{id:id(2)});
    const res=await POST(request({action:'lookup',raw:JSON.stringify({v:1,kind:'trial',code:token})}));
    expect(res.status).toBe(200);
    expect((await res.json()).subject).toEqual({kind:'trial_pass',id:id(2)});
    expect(state.db.from.mock.calls).toEqual([['trial_passes']]);
    expect(state.db.from.mock.results[0].value.eq).toHaveBeenCalledWith('qr_token_hash',hashPassToken(token));
    expect(state.db.rpc).not.toHaveBeenCalled();
  });
  it('resolves a legacy native Trial Pass only against the exact server-issued trial code',async()=>{
    state.db=database(null,null,false,{id:id(3)});
    const res=await POST(request({action:'lookup',raw:JSON.stringify({v:1,kind:'trial',code:'012345abcdef',id:id(99)})}));
    expect(res.status).toBe(200);
    expect((await res.json()).subject).toEqual({kind:'member',id:id(3)});
    expect(state.db.from.mock.calls).toEqual([['member_profiles']]);
    const query=state.db.from.mock.results[0].value;
    expect(query.eq.mock.calls).toEqual([['trial_pass_code','012345abcdef'],['subscription_plan','trial']]);
    expect(state.db.rpc).not.toHaveBeenCalled();
  });
  it.each(['012345abcdef','a'.repeat(43)])('does not resolve a missing native trial credential (%s)',async code=>{
    const res=await POST(request({action:'lookup',raw:JSON.stringify({v:1,kind:'trial',code})}));
    expect(res.status).toBe(404);
    expect(state.db.rpc).not.toHaveBeenCalled();
  });
  it.each(['012345abcdef','a'.repeat(43)])('fails closed on native trial database failure (%s)',async code=>{
    state.db=database(null,null,true);
    const res=await POST(request({action:'lookup',raw:JSON.stringify({v:1,kind:'trial',code})}));
    expect(res.status).toBe(503);
    expect(state.db.from).toHaveBeenCalledTimes(1);
    expect(state.db.rpc).not.toHaveBeenCalled();
  });
  it('rejects malformed, forged, wrong-version and ticket JSON envelopes before database reads',async()=>{
    const rawPayloads=[
      '{"v":1,', JSON.stringify({v:2,kind:'trial',code:'a'.repeat(43)}),
      JSON.stringify({v:1,kind:'ticket',code:'a'.repeat(43)}),
      JSON.stringify({v:1,kind:'trial',code:'SDGA-ABCD-ABCD-ABCD-ABCD-ABCD-ABCD'}),
      JSON.stringify({v:1,kind:'trial',code:{id:id(1)}}),
      JSON.stringify({v:1,kind:'trial',code:id(1)}),
      JSON.stringify({v:1,kind:'trial',id:id(1)}),
    ];
    for(const raw of rawPayloads) expect((await POST(request({action:'lookup',raw}))).status).toBe(400);
    expect(state.db.from).not.toHaveBeenCalled();
  });
  it('still supports the native paid-member bare token',async()=>{
    state.db=database({member_profile_id:id(1),revoked_at:null});
    const res=await POST(request({action:'lookup',raw:'a'.repeat(43)}));
    expect(res.status).toBe(200);
    expect((await res.json()).subject).toEqual(subject);
    expect(state.db.rpc).not.toHaveBeenCalled();
  });
  it('does not mislabel an unrecognized QR as an event ticket',async()=>{
    const res=await POST(request({action:'lookup',raw:'unrecognized QR contents'}));
    expect(res.status).toBe(400);
    expect((await res.json()).error).not.toContain('ticket');
    expect(state.db.from).not.toHaveBeenCalled();
  });
  it.each([
    ['current trial',JSON.stringify({v:1,kind:'trial',code:'a'.repeat(43)}),'trial_pass'],
    ['legacy trial',JSON.stringify({v:1,kind:'trial',code:'012345abcdef'}),'member'],
    ['paid member','a'.repeat(43),'member'],
  ])('decodes a rendered native %s QR and resolves it without writes',async(_label,raw,kind)=>{
    const png=await QRCode.toBuffer(raw,{width:512,margin:4});
    const {data,info}=await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const decoded=jsQR(new Uint8ClampedArray(data),info.width,info.height);
    expect(decoded?.data).toBe(raw);
    state.db=database({member_profile_id:id(1),revoked_at:null},{id:id(2)},false,{id:id(3)});
    const res=await POST(request({action:'lookup',raw:decoded.data}));
    expect(res.status).toBe(200);
    expect((await res.json()).subject.kind).toBe(kind);
    expect(state.db.rpc).not.toHaveBeenCalled();
  });
  it('allows warnings without restriction confirmation but never without identity',()=>{
    const warning={...input,action:'warning',restriction_confirmed:false};
    expect(()=>validateIncident(warning)).not.toThrow();expect(()=>validateIncident({...warning,identity_confirmed:false})).toThrow();
  });
});
