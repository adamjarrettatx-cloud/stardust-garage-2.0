import { beforeEach,describe,it,expect,vi } from 'vitest';
const m=vi.hoisted(()=>({access:vi.fn(),rpc:vi.fn(),from:vi.fn(),upload:vi.fn(),download:vi.fn(),remove:vi.fn(),rate:vi.fn(),pdf:vi.fn()}));
vi.mock('@/lib/w9/server',()=>({
  w9Access:m.access,w9Json:(body,status=200)=>Response.json(body,{status}),
  w9DatabaseError:()=>Response.json({error:'Operation blocked'},{status:409}),loadW9History:vi.fn(),
}));
vi.mock('@/lib/w9/pdf',()=>({renderW9Pdf:m.pdf}));
vi.mock('@/lib/rate-limit',()=>({rateLimit:m.rate}));
import { POST as submit } from '@/app/api/portal/w9/route';
import { POST as review } from '@/app/api/admin/w9/[id]/review/route';
const id='77777777-7777-4777-8777-777777777777';
const valid={id,legalName:'TEST ARTIST ONLY',classification:'individual',address:'123 Example',cityStateZip:'Austin TX 78701',
  tinType:'ssn',tin:'123456789',foreignOwners:false,backupWithholding:false,usPerson:true,certified:true,signature:'TEST ARTIST ONLY',consentVersion:'sdg-w9-v1'};
const req=body=>new Request('https://sdgatx.com/api/portal/w9',{method:'POST',headers:{origin:'https://sdgatx.com','content-type':'application/json'},body:JSON.stringify(body)});
const params={params:Promise.resolve({id})};
beforeEach(()=>{
  vi.resetAllMocks();
  const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:null})};
  m.from.mockReturnValue(q);m.rpc.mockResolvedValue({data:id});
  m.upload.mockResolvedValue({data:{}});m.download.mockResolvedValue({data:new Blob(['original signed PDF'])});m.remove.mockResolvedValue({});
  m.pdf.mockResolvedValue(Buffer.from('new signed PDF'));m.rate.mockReturnValue({ok:true});
  m.access.mockResolvedValue({user:{id:'actor'},partner:{contact_id:'contact'},admin:{from:m.from,rpc:m.rpc,storage:{from:()=>({upload:m.upload,download:m.download,remove:m.remove})}}});
});
describe('W-9 API operations',()=>{
  it('honors denied auth before touching PDF or storage',async()=>{
    m.access.mockResolvedValue({response:Response.json({error:'Denied'},{status:403})});
    expect((await submit(req(valid))).status).toBe(403);expect(m.pdf).not.toHaveBeenCalled();
  });
  it('rejects malformed fields and never echoes the submitted tax number',async()=>{
    const response=await submit(req({...valid,classification:'invalid'}));
    expect(response.status).toBe(400);expect(await response.text()).not.toContain(valid.tin);expect(m.upload).not.toHaveBeenCalled();
  });
  it('honors the existing rate limiter ok contract',async()=>{
    m.rate.mockReturnValue({ok:false});expect((await submit(req(valid))).status).toBe(429);
  });
  it('passes only metadata to the atomic database transaction',async()=>{
    expect((await submit(req(valid))).status).toBe(201);
    const args=m.rpc.mock.calls[0][1];
    expect(args.p_path).toBe(`w9/contact/${id}.pdf`);
    expect(JSON.stringify(args)).not.toContain(valid.tin);
    expect(JSON.stringify(args)).not.toContain(valid.legalName);
    expect(m.upload.mock.calls[0][2].upsert).toBe(false);
  });
  it('uses original immutable bytes after an interrupted confirmation',async()=>{
    m.upload.mockResolvedValue({error:{message:'already exists'}});
    expect((await submit(req(valid))).status).toBe(201);
    expect(m.rpc.mock.calls[0][1].p_size).toBe(Buffer.byteLength('original signed PDF'));
  });
  it('retains the file after an ambiguous database error',async()=>{
    m.rpc.mockResolvedValue({error:{message:'network timeout'}});
    expect((await submit(req(valid))).status).toBe(409);expect(m.remove).not.toHaveBeenCalled();
  });
  it('requires review confirmation and a denial reason, forbids TIN in comments',async()=>{
    for(const body of [{decision:'approved',confirmed:false},{decision:'denied',confirmed:true,reason:''},{decision:'denied',confirmed:true,reason:'Wrong 123-45-6789'}])
      expect((await review(req(body),params)).status).toBe(400);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it('reviews using the authenticated reviewer, never a client-selected actor',async()=>{
    expect((await review(req({decision:'approved',confirmed:true}),params)).status).toBe(200);
    expect(m.rpc).toHaveBeenCalledWith('review_artist_w9',{p_id:id,p_actor:'actor',p_decision:'approved',p_reason:null});
    expect((await review(req({decision:'approved',confirmed:true,actor:'someone-else'}),params)).status).toBe(400);
  });
});
