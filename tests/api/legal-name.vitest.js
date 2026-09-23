import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/capacity/legal-name/route';
const state = vi.hoisted(() => ({ gate: null, rpc: vi.fn() }));
vi.mock('@/lib/auth-helpers', () => ({ requireFrontDeskOrTeam: async () => state.gate }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc: state.rpc }) }));
const body = { subject: { kind: 'trial_pass', id: '00000000-0000-4000-8000-000000000001' },
  expectedName: 'John Doe', fullName: 'José García', reason: 'Corrected against ID', idChecked: true };
const request = payload => new Request('https://example.invalid/api/capacity/legal-name', { method: 'POST', body: JSON.stringify(payload) });
beforeEach(() => { state.gate={ user:{id:'verified-staff'},unauthorized:false }; state.rpc.mockReset(); state.rpc.mockResolvedValue({data:{fullName:'José García'}}); });
describe('legal-name correction authorization', () => {
  it('denies unauthenticated and non-staff before storage', async () => {
    state.gate={unauthorized:true};
    expect((await POST(request(body))).status).toBe(401);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it('validates name, subject, ID check and reason', async () => {
    for (const patch of [{fullName:'John'},{subject:{kind:'user',id:body.subject.id}},
      {subject:{kind:'member',id:'bad'}},{idChecked:false},{reason:''},{reason:'X'.repeat(501)},{expectedName:null}]) {
      expect((await POST(request({...body,...patch}))).status).toBe(400);
    }
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it('uses authenticated actor, ignoring client role/user/identity claims', async () => {
    expect((await POST(request({...body,p_actor:'forged',role:'admin',identity_keys:['user:forged']}))).status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith('correct_legal_name',{
      p_actor:'verified-staff',p_kind:'trial_pass',p_id:body.subject.id,p_expected_name:'John Doe',
      p_name:'José García',p_reason:'Corrected against ID',
    });
  });
  it('never reports success on RPC failure or stale writes', async () => {
    for (const [code,status] of [['42501',403],['40001',409],['P0002',404],['42P01',409]]) {
      state.rpc.mockResolvedValue({error:{code}});
      expect((await POST(request(body))).status).toBe(status);
    }
    state.rpc.mockRejectedValue(new Error('offline'));
    expect((await POST(request(body))).status).toBe(503);
  });
});
