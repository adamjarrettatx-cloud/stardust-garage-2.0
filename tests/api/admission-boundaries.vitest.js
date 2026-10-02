import {beforeEach,it,expect,vi} from 'vitest';
const s=vi.hoisted(()=>({gate:{},db:null}));
vi.mock('@/lib/auth-helpers',()=>({requireFrontDeskOrTeam:async()=>s.gate,getRequestUser:async()=>s.gate.user}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:()=>s.db}));
vi.mock('@/lib/supabase/stub',()=>({isSupabaseConfigured:()=>true}));
vi.mock('@/lib/feature-flags',()=>({isTicketScannerEnabled:()=>true,isInternalTicketingEnabled:()=>true}));
vi.mock('@/lib/rate-limit',()=>({rateLimit:()=>({ok:true}),keyFromRequest:()=> 'test'}));
import {POST as ticketScan} from '@/app/api/tickets/scan/route';
import {GET as photoGet,DELETE as photoDelete} from '@/app/api/account/profile-photo/route';
const req=body=>new Request('https://example.invalid/api/tickets/scan',{method:'POST',body:JSON.stringify(body)});
beforeEach(()=>{
  s.gate={unauthorized:false,user:{id:'owner'}};
  const chain={select:()=>chain,eq:()=>chain,maybeSingle:async()=>({data:{profile_photo_path:'other/photo.jpg'}}),update:vi.fn(()=>chain),then:r=>Promise.resolve({}).then(r)};
  s.db={from:vi.fn(()=>chain),storage:{from:vi.fn(()=>({createSignedUrl:vi.fn(),remove:vi.fn()}))}};
});
it('unauthenticated callers never reach a privileged database client',async()=>{
  s.gate={unauthorized:true};
  expect((await ticketScan(req({mode:'preview'}))).status).toBe(401);
  expect(s.db.from).not.toHaveBeenCalled();
});
it('old clients and admin override flags cannot redeem tickets without a pass',async()=>{
  for(const override of [false,true]){
    const res=await ticketScan(req({mode:'checkin',code:'SDGA-ABCD-ABCD-ABCD-ABCD-ABCD-ABCD',event_id:'event',override}));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('guest_pass_required');
  }
  expect(s.db.from).not.toHaveBeenCalled();
});
it('a poisoned account photo pointer cannot read or delete another object',async()=>{
  const get=await photoGet(new Request('https://example.invalid/api/account/profile-photo'));
  expect((await get.json()).signedUrl).toBeNull();
  expect((await photoDelete(new Request('https://example.invalid/api/account/profile-photo',{method:'DELETE'}))).status).toBe(200);
  expect(s.db.storage.from).not.toHaveBeenCalled();
});
