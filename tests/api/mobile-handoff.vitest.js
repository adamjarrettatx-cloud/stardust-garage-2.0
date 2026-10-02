import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({
  user:{id:'user',email:'test@example.invalid'},limit:true,
  generate:vi.fn(),verify:vi.fn(),
}));
vi.mock('@supabase/supabase-js',()=>({createClient:()=>({auth:{getUser:async()=>({data:{user:state.user}})}})}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:()=>({auth:{admin:{generateLink:state.generate}}})}));
vi.mock('@/lib/rate-limit',()=>({rateLimit:()=>({ok:state.limit,retryAfterSeconds:60})}));
vi.mock('@supabase/ssr',()=>({createServerClient:()=>({auth:{verifyOtp:state.verify}})}));
import {POST} from '@/app/api/mobile/handoff-token/route';
import {GET} from '@/app/handoff/route';
import {openHandoff,sealHandoff} from '@/lib/mobile-handoff-token.mjs';
beforeEach(()=>{
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','isolated-test-only-not-a-real-key-1234567890');
  state.user={id:'user',email:'test@example.invalid'};state.limit=true;
  state.generate.mockReset().mockResolvedValue({data:{user:{id:'user'},properties:{hashed_token:'private-hash'}}});
  state.verify.mockReset().mockResolvedValue({data:{user:{id:'user'}}});
});
const mint=()=>POST(new Request('https://www.sdgatx.com/api/mobile/handoff-token',{
  method:'POST',headers:{Authorization:'Bearer fixture'},body:JSON.stringify({returnTo:'/members'}),
}));
it('mints no raw auth credential, rate limits and denies shared station accounts',async()=>{
  const r=await mint(),body=await r.json();
  expect(r.status).toBe(200);expect(body.token).toMatch(/^v1\./);
  expect(openHandoff(body.token,process.env.SUPABASE_SERVICE_ROLE_KEY).returnTo).toBe('/members');
  expect(r.headers.get('cache-control')).toBe('private, no-store');
  state.limit=false;expect((await mint()).status).toBe(429);
  state.limit=true;state.user={id:'station',app_metadata:{station_account:true}};
  expect((await mint()).status).toBe(401);
});
it('does not issue handoff when generated link belongs to another identity',async()=>{
  state.generate.mockResolvedValue({data:{user:{id:'other'},properties:{hashed_token:'private'}}});
  expect((await mint()).status).toBe(500);
});
it('rejects expired tokens and changed destinations before OTP verification',async()=>{
  const expired=sealHandoff({tokenHash:'inner',userId:'user',returnTo:'/members'},process.env.SUPABASE_SERVICE_ROLE_KEY,Date.now()-60001);
  const token=(await (await mint()).json()).token;
  for(const [t,path] of [[expired,'/members'],[token,'/account'],['raw-auth-hash','/members']]){
    const r=await GET(new Request(`https://www.sdgatx.com/handoff?token=${t}&return_to=${path}`));
    expect(r.headers.get('location')).toContain('/login?');
    expect(r.headers.get('referrer-policy')).toBe('no-referrer');
  }
  expect(state.verify).not.toHaveBeenCalled();
});
it('verifies the encrypted identity and rejects replay/identity mismatch',async()=>{
  const token=(await (await mint()).json()).token;
  const req=()=>new Request(`https://www.sdgatx.com/handoff?token=${token}&return_to=/members`);
  expect((await GET(req())).headers.get('location')).toBe('https://www.sdgatx.com/members');
  expect(state.verify).toHaveBeenCalledWith({token_hash:'private-hash',type:'magiclink'});
  state.verify.mockResolvedValue({error:{message:'already used'}});
  expect((await GET(req())).headers.get('location')).toContain('/login?');
  state.verify.mockResolvedValue({data:{user:{id:'other'}}});
  expect((await GET(req())).headers.get('location')).toContain('/login?');
});
