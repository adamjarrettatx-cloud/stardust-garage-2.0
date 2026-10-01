import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ user: null, reads: [], writes: [], previous: null, failed: false, photoExists: true }));
vi.mock('@/lib/auth-helpers', () => ({ getRequestUser: async () => state.user }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => ({ ok: true }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({
  from(table) {
    const filters = {};
    const chain = {
      select() { return chain; }, eq(k,v) { filters[k]=v; return chain; },
      async maybeSingle() { state.reads.push({ table, filters }); return { data: table === 'membership_quiz_results' ? null : state.previous, error: state.failed ? { code: 'offline' } : null }; },
      async insert(data) { state.writes.push(data); return { error: state.failed ? { code: 'offline' } : null }; },
    };
    return chain;
  },
  storage: { from: () => ({ list: async () => ({ data: state.photoExists ? [{ name: 'photo.jpg' }] : [], error: null }) }) },
}) }));
import { POST } from '@/app/api/members/apply/route';
const user = { id: '00000000-0000-4000-8000-000000000001', email: 'account@example.invalid' };
const body = {
  plan:'weekender',submission_key:'00000000-0000-4000-8000-000000000002',
  full_name:'Test Person',preferred_name:null,website:null,email:'forged@example.invalid',
  phone:'5125550100',social_handle:'@test',birthday:'1990-01-01',
  why_stardust:'Community',how_did_you_hear:'Friend',how_contribute:'Art',what_experiences:'Music',
  agreed_ethos:true,agreed_renewal:true,agreed_house_rules:true,
  profile_photo_path:`member-app/${user.id}/00000000-0000-4000-8000-000000000003/photo.jpg`,
};
const request=(payload=body,origin='https://sdg.invalid')=>new Request('https://sdg.invalid/api/members/apply',{method:'POST',headers:{origin},body:JSON.stringify(payload)});
beforeEach(()=>{state.user=user;state.reads=[];state.writes=[];state.previous=null;state.failed=false;state.photoExists=true;});
it('requires authentication and same-origin requests before privileged reads',async()=>{
  state.user=null;expect((await POST(request())).status).toBe(401);
  state.user=user;expect((await POST(request(body,'https://evil.invalid'))).status).toBe(403);
  expect(state.reads).toHaveLength(0);expect(state.writes).toHaveLength(0);
});
it('sets account/email/status server-side and uses authenticated account for every lookup',async()=>{
  expect((await POST(request({...body,applicant_user_id:'victim',status:'approved'}))).status).toBe(200);
  expect(state.writes[0]).toMatchObject({applicant_user_id:user.id,email:user.email,status:'new'});
  for(const r of state.reads)expect(r.filters.applicant_user_id||r.filters.user_id).toBe(user.id);
});
it('rejects another account photo, absent photo, underage DOB and unknown plan',async()=>{
  expect((await POST(request({...body,profile_photo_path:'member-app/other/photo.jpg'}))).status).toBe(400);
  expect((await POST(request({...body,birthday:'2020-01-01'}))).status).toBe(400);
  expect((await POST(request({...body,plan:'free'}))).status).toBe(400);
  state.photoExists=false;expect((await POST(request())).status).toBe(400);
  expect(state.writes).toHaveLength(0);
});
it('retries are idempotent and database errors never claim success',async()=>{
  state.previous={id:'existing'};
  const response=await POST(request());expect((await response.json()).alreadySubmitted).toBe(true);
  expect(state.writes).toHaveLength(0);
  state.previous=null;state.failed=true;expect((await POST(request())).status).toBe(503);
});
