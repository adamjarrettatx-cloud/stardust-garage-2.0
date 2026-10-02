import { beforeEach, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({user:{id:'server-user'},enabled:true,limited:false,rpc:vi.fn()}));
vi.mock('@/lib/auth-helpers',()=>({getRequestUser:vi.fn(async()=>state.user)}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:()=>({rpc:state.rpc})}));
vi.mock('@/lib/feature-flags',()=>({isInternalTicketingEnabled:()=>state.enabled}));
vi.mock('@/lib/rate-limit',()=>({rateLimit:()=>({ok:!state.limited,retryAfterSeconds:60})}));
import { POST } from '@/app/api/wallet/guest-ticket/route';
const ticket='00000000-0000-4000-8000-000000000050';
const body={ticket_id:ticket,reserved_for_guest:true,expected_reserved_for_guest:false};
function request(payload=body,headers={Authorization:'Bearer verified-in-auth-helper'}) {
  return new Request('https://www.sdgatx.com/api/wallet/guest-ticket',{
    method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(payload),
  });
}
beforeEach(()=>{
  state.user={id:'server-user'}; state.enabled=true; state.limited=false;
  state.rpc.mockReset().mockResolvedValue({data:{id:ticket,status:'valid',reserved_for_guest:true}});
});
it('requires verified identity, blocks stations, and never trusts a supplied actor',async()=>{
  state.user=null;
  expect((await POST(request())).status).toBe(401);
  state.user={id:'station',app_metadata:{station_account:true}};
  expect((await POST(request())).status).toBe(401);
  expect(state.rpc).not.toHaveBeenCalled();
  state.user={id:'server-user'};
  expect((await POST(request({...body,actor_id:'victim',user_id:'victim'}))).status).toBe(200);
  expect(state.rpc).toHaveBeenCalledWith('set_ticket_guest_reservation',{
    p_actor:'server-user',p_ticket:ticket,p_reserved:true,p_expected:false,
  });
});
it('requires same-origin browser writes while supporting bearer mobile requests',async()=>{
  expect((await POST(request(body,{}))).status).toBe(403);
  expect((await POST(request(body,{Origin:'https://attacker.invalid'}))).status).toBe(403);
  expect((await POST(request(body,{Origin:'https://www.sdgatx.com'}))).status).toBe(200);
});
it('validates booleans and UUIDs before database access',async()=>{
  for(const payload of [null,{}, {...body,ticket_id:'bad'},{...body,reserved_for_guest:'true'},{...body,expected_reserved_for_guest:null}]){
    expect((await POST(request(payload))).status).toBe(400);
  }
  expect(state.rpc).not.toHaveBeenCalled();
});
it('fails closed on ownership, consumed tickets, unavailable migration and malformed server result',async()=>{
  for(const [code,status] of [['P0002',404],['P0001',409],['PGRST202',503],['XX000',503]]){
    state.rpc.mockResolvedValue({error:{code,message:'private database diagnostic'}});
    const result=await POST(request());
    expect(result.status).toBe(status);
    expect(await result.text()).not.toContain('private database diagnostic');
  }
  state.rpc.mockResolvedValue({data:{id:ticket,reserved_for_guest:false}});
  expect((await POST(request())).status).toBe(503);
  state.rpc.mockRejectedValue(new Error('offline'));
  expect((await POST(request())).status).toBe(503);
});
it('rate limits writes and disables caching of success',async()=>{
  state.limited=true;
  expect((await POST(request())).status).toBe(429);
  expect(state.rpc).not.toHaveBeenCalled();
  state.limited=false;
  expect((await POST(request())).headers.get('cache-control')).toBe('private, no-store');
  state.enabled=false;
  expect((await POST(request())).status).toBe(404);
});
