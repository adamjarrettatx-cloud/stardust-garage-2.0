import { beforeEach,describe,it,expect,vi } from 'vitest';
const mock=vi.hoisted(()=>({partner:vi.fn(),adminAuth:vi.fn(),rpc:vi.fn(),from:vi.fn()}));
vi.mock('@/lib/auth-helpers',()=>({requirePartner:mock.partner,requireAdminMfa:mock.adminAuth}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:()=>({rpc:mock.rpc,from:mock.from})}));
import { w9Access,validW9Origin,w9BookingCheck,taxDocumentAccess,nonTaxStorageCheck } from '@/lib/w9/server';
const user={id:'artist'};
const partner={contact_id:'contact',contact_type:['artist'],activated_at:'now',full_name:'Test',photo_url:'/photo'};
const request=(headers={origin:'https://sdgatx.com'})=>new Request('https://sdgatx.com/api/portal/w9',{method:'POST',headers});
beforeEach(()=>{
  vi.resetAllMocks();
  mock.partner.mockResolvedValue({user,partner});
  mock.adminAuth.mockResolvedValue({user:{id:'reviewer'}});
  mock.rpc.mockImplementation(async name=>({data:name==='w9_enabled'}));
});
describe('W-9 server authorization',()=>{
  it('requires authentication',async()=>{
    mock.partner.mockResolvedValue({unauthorized:true});
    expect((await w9Access(request(),{write:true})).response.status).toBe(401);
  });
  it('rejects cookie writes without matching origin',async()=>{
    for(const headers of [{},{origin:'https://evil.test'},{origin:'https://sdgatx.com.evil.test'}])
      expect((await w9Access(request(headers),{write:true})).response.status).toBe(403);
    expect(validW9Origin(request())).toBe(true);
    expect(validW9Origin(request({authorization:'Bearer verified-by-requirePartner'}))).toBe(true);
  });
  it.each(['activated_at','full_name','photo_url'])('blocks incomplete %s',async field=>{
    mock.partner.mockResolvedValue({user,partner:{...partner,[field]:null}});
    expect((await w9Access(request())).response.status).toBe(403);
  });
  it('requires both administrator auth and reviewer allowlist membership',async()=>{
    expect((await w9Access(request(),{reviewer:true})).response.status).toBe(403);
    mock.rpc.mockResolvedValue({data:true});
    expect((await w9Access(request(),{reviewer:true})).user.id).toBe('reviewer');
    mock.adminAuth.mockResolvedValue({unauthorized:true});
    expect((await w9Access(request(),{reviewer:true})).response.status).toBe(401);
  });
  it('fails closed when feature state or approval lookup is unavailable',async()=>{
    mock.rpc.mockResolvedValue({error:{message:'unavailable'}});
    expect((await w9BookingCheck({rpc:mock.rpc},'contact')).status).toBe(503);
    mock.rpc.mockImplementation(async name=>name==='w9_enabled'?{data:true}:{error:{}});
    expect((await w9BookingCheck({rpc:mock.rpc},'contact')).status).toBe(503);
  });
  it('unlocks only approved artists when enabled',async()=>{
    expect((await w9BookingCheck({rpc:mock.rpc},'contact')).status).toBe(409);
    mock.rpc.mockResolvedValue({data:true});
    expect(await w9BookingCheck({rpc:mock.rpc},'contact')).toBe(null);
  });
  it('denies signed document mutation even to an authorized reviewer',async()=>{
    mock.rpc.mockResolvedValue({data:true});
    mock.from.mockImplementation(table=>{
      const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:table==='documents'?{id:'doc',category:'tax'}:{id:'submission'}})};
      return q;
    });
    expect(await taxDocumentAccess({from:mock.from,rpc:mock.rpc},'reviewer','doc',{write:true})).toBe(false);
  });
  it('never lets an unrelated partner read a tax document',async()=>{
    mock.from.mockImplementation(table=>{
      const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:table==='documents'?{category:'tax'}:table==='partner_profiles'?{contact_id:'other'}:null})};
      return q;
    });
    expect(await taxDocumentAccess({from:mock.from,rpc:mock.rpc},'artist','doc')).toBe(false);
  });
  it('refuses tax-object pointers through templates and other file paths',async()=>{
    mock.rpc.mockResolvedValue({data:true});
    expect((await nonTaxStorageCheck({rpc:mock.rpc},'w9/contact/document.pdf')).status).toBe(403);
    mock.rpc.mockResolvedValue({error:{message:'unavailable'}});
    expect((await nonTaxStorageCheck({rpc:mock.rpc},'templates/file.pdf')).status).toBe(503);
    mock.rpc.mockResolvedValue({data:false});
    expect(await nonTaxStorageCheck({rpc:mock.rpc},'templates/file.pdf')).toBe(null);
  });
});
