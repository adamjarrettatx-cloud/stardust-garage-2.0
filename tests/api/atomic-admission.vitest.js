import { beforeEach, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({blocked:null}));
vi.mock('@/lib/capacity/access-restrictions',()=>({restrictionGuard:vi.fn(async()=>state.blocked)}));
vi.mock('next/server',async original=>({...await original(),after:vi.fn()}));
import { commitAdmission } from '@/lib/capacity/commit-admission';
import { after } from 'next/server';
const input={actorId:'staff',kind:'member',subjectId:'member',tokenHash:'hash',eventId:'event',sessionId:'session'};
let admin;
beforeEach(()=>{state.blocked=null;vi.clearAllMocks();admin={rpc:vi.fn(async()=>({data:{ok:true,result:'verified',ticket:{result:'valid'}}}))};});
it('never calls admission when restrictions cannot be cleared',async()=>{
  for(const status of [403,409,503]){
    state.blocked=new Response('Hold entry',{status});
    expect((await commitAdmission(admin,input)).status).toBe(status);
  }
  expect(admin.rpc).not.toHaveBeenCalled();
});
it('uses only server-resolved actor, subject and token hash',async()=>{
  expect((await commitAdmission(admin,input)).status).toBe(200);
  expect(admin.rpc).toHaveBeenCalledWith('commit_door_admission',{
    p_actor:'staff',p_device:null,p_kind:'member',p_subject:'member',p_token_hash:'hash',
    p_event:'event',p_session:'session',p_ticket_code:null,p_station_hash:null,
  });
  expect(after).toHaveBeenCalledTimes(1);
});
it('fails closed on missing migration, DB outage, or policy denial',async()=>{
  for(const [code,status] of [['P0001',409],['42501',409],['XX000',503],['PGRST202',503]]){
    admin.rpc.mockResolvedValue({error:{code,message:'Hold entry'}});
    expect((await commitAdmission(admin,input)).status).toBe(status);
  }
  expect(after).not.toHaveBeenCalled();
});
it('does not turn duplicate response into admission or send a second notification',async()=>{
  admin.rpc.mockResolvedValue({data:{ok:false,result:'already_used',reason:'Already checked in'}});
  expect((await commitAdmission(admin,input)).status).toBe(409);
  expect(after).not.toHaveBeenCalled();
});
it('rejects malformed supplied group QR instead of silently selecting another ticket',async()=>{
  expect((await commitAdmission(admin,{...input,ticketCode:{id:'forged'}})).status).toBe(400);
  expect(admin.rpc).not.toHaveBeenCalled();
});
