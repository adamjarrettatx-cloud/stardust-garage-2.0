import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  gate: { unauthorized: false, user: { id: 'staff' } },
  load: vi.fn(), guard: vi.fn(), rpc: vi.fn(), admin: null,
}));
vi.mock('@/lib/auth-helpers', () => ({ requireFrontDeskOrTeam: async () => mocks.gate }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks.admin }));
vi.mock('@/lib/capacity/arrival-roster-server', () => ({ loadRoster: (...args) => mocks.load(...args) }));
vi.mock('@/lib/capacity/access-restrictions', () => ({ restrictionGuard: (...args) => mocks.guard(...args) }));
import { GET } from '@/app/api/team/trial-pass/today/route';
import { POST } from '@/app/api/capacity/trial-pass/roster-checkin/route';
const id = '00000000-0000-4000-8000-000000000002';
const wire = { id, kind:'trial_pass', full_name:'Test Guest', checked_in_at:null, admission_reason:null };
const roster = () => ({ people:[{ wire:{ ...wire }, identityKeys:[`trial_pass:${id}`], group:[{kind:'trial_pass',id}] }],
  signins:[wire], shiftDay:'2026-09-24', since:'2026-09-24T11:00:00Z', context:{ session:null }, truncated:false });
const req = body => new Request('https://example.invalid/api/capacity/trial-pass/roster-checkin', { method:'POST', body:JSON.stringify(body) });
const body = {id,kind:'trial_pass',identityConfirmed:true,admissionConfirmed:true};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.gate = { unauthorized:false,user:{id:'staff'} };
  mocks.admin = { rpc:mocks.rpc };
  mocks.load.mockResolvedValue(roster());
  mocks.guard.mockResolvedValue(null);
  mocks.rpc.mockResolvedValue({data:{alreadyCheckedIn:false,arrival:{checked_in_at:'2026-09-25T01:03:00Z'}}});
});
describe('guest search endpoint', () => {
  it('rejects unauthorized callers before any directory reads', async () => {
    mocks.gate.unauthorized=true;
    expect((await GET(new Request('https://example.invalid/?q=Test'))).status).toBe(401);
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it('search is a bounded read-only operation and private response is not cached', async () => {
    const res = await GET(new Request('https://example.invalid/?q=Test'));
    expect(mocks.load).toHaveBeenCalledWith(mocks.admin,{query:'Test'});
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect((await res.json()).signins).toEqual([wire]);
  });
  it('does not enumerate on single-letter or overlong names', async () => {
    expect((await GET(new Request('https://example.invalid/?q=T'))).status).toBe(200);
    expect((await GET(new Request(`https://example.invalid/?q=${'T'.repeat(121)}`))).status).toBe(400);
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it('database failures are not represented as an empty successful roster', async () => {
    mocks.load.mockRejectedValue(new Error('Guest lookup unavailable.'));
    expect((await GET(new Request('https://example.invalid/'))).status).toBe(503);
  });
});
describe('named arrival check-in endpoint', () => {
  it('requires authorization, typed identity and explicit confirmations', async () => {
    mocks.gate.unauthorized=true;
    expect((await POST(req(body))).status).toBe(401);
    mocks.gate.unauthorized=false;
    for (const bad of [{...body,id:'bad'}, {...body,kind:'account'}, {...body,identityConfirmed:false}, {...body,admissionConfirmed:false}]) {
      expect((await POST(req(bad))).status).toBe(400);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rechecks restrictions for every linked identity before mutation', async () => {
    const data=roster();data.people[0].group.push({kind:'guest',id});
    mocks.load.mockResolvedValue(data);
    mocks.guard.mockResolvedValueOnce(null).mockResolvedValueOnce(new Response('{}',{status:403}));
    expect((await POST(req(body))).status).toBe(403);
    expect(mocks.guard).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('expired passes, missing photos, inactive members and missing entitlements do not admit', async () => {
    for (const reason of ['Trial pass expired.','Profile photo unavailable.','Membership is not active.','No active pass linked.']) {
      const data=roster();data.people[0].wire.admission_reason=reason;mocks.load.mockResolvedValue(data);
      expect((await POST(req(body))).status).toBe(409);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('uses authenticated actor, authoritative identity and DB timestamp, ignoring forged fields', async () => {
    const res = await POST(req({...body,p_actor:'attacker',activity_at:'2999-01-01',identityKeys:['forged']}));
    expect(res.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('front_desk_roster_check_in',{
      p_kind:'trial_pass',p_id:id,p_identity_keys:[`trial_pass:${id}`],p_actor:'staff',p_door_session_id:null,
    });
    expect((await res.json()).row.activity_at).toBe('2026-09-25T01:03:00Z');
  });
  it('already checked-in rows retain their timestamp without another capacity mutation', async () => {
    const data=roster();data.people[0].wire.checked_in_at='2026-09-25T01:00Z';
    mocks.load.mockResolvedValue(data);
    const json=await (await POST(req(body))).json();
    expect(json.alreadyCheckedIn).toBe(true);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('an unsuccessful atomic write never reports a successful check-in', async () => {
    mocks.rpc.mockResolvedValue({error:{code:'P0001',message:'At capacity. Hold entry.'}});
    expect((await POST(req(body))).status).toBe(409);
    mocks.load.mockRejectedValue(new Error('Identity unavailable'));
    expect((await POST(req(body))).status).toBe(503);
  });
});
