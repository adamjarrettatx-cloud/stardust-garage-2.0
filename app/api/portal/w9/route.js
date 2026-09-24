import crypto from 'node:crypto';
import { validateW9 } from '@/lib/w9/form';
import { renderW9Pdf } from '@/lib/w9/pdf';
import { w9Access,w9Json,loadW9History,w9DatabaseError } from '@/lib/w9/server';
import { rateLimit } from '@/lib/rate-limit';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=30;
export async function GET(request){
  const a=await w9Access(request);if(a.response)return a.response;
  try{return w9Json({submissions:await loadW9History(a.admin,a.partner.contact_id)})}
  catch{return w9Json({error:'Could not load your W-9 status.'},503)}
}
export async function POST(request){
  const a=await w9Access(request,{write:true});if(a.response)return a.response;
  const limit=rateLimit({key:`w9-submit:${a.user.id}`,limit:8,windowMs:60000});
  if(!limit.ok)return w9Json({error:'Too many attempts. Please wait a minute.'},429);
  const text=await request.text();
  if(text.length>12000)return w9Json({error:'Form is too large.'},413);
  let body;try{body=JSON.parse(text)}catch{return w9Json({error:'Invalid form.'},400)}
  const result=validateW9(body);
  if(!result.ok)return w9Json({error:result.error},400);
  const {data:existing,error:lookupError}=await a.admin.from('w9_submissions').select('id,contact_id,submitted_by')
    .eq('id',result.data.id).maybeSingle();
  if(lookupError)return w9Json({error:'W-9 records are unavailable.'},503);
  if(existing){
    if(existing.contact_id!==a.partner.contact_id||existing.submitted_by!==a.user.id)return w9Json({error:'Reload the form.'},409);
    return w9Json({ok:true,already_submitted:true});
  }
  const signedAt=new Date().toISOString();
  let pdf;
  try{pdf=await renderW9Pdf(result.data,{userId:a.user.id,signedAt,submissionId:result.data.id})}
  catch{return w9Json({error:'Could not fit all entries legibly on the IRS form. Check long text fields; contact Stardust Garage if your legal name uses characters the form cannot display. No form was submitted.'},422)}
  const id=result.data.id;
  const storagePath=`w9/${a.partner.contact_id}/${id}.pdf`;
  const storage=a.admin.storage.from('documents');
  const {error:uploadError}=await storage.upload(storagePath,pdf,{contentType:'application/pdf',upsert:false});
  if(uploadError){
    // Recover a previous upload whose database confirmation was interrupted.
    // Its original bytes/signature/time stay authoritative, not the retry body.
    const {data:original,error:readError}=await storage.download(storagePath);
    if(readError||!original)return w9Json({error:'Could not save your W-9. Please retry.'},503);
    pdf=Buffer.from(await original.arrayBuffer());
  }
  const {error}=await a.admin.rpc('submit_artist_w9',{
    p_id:id,p_document:id,p_contact:a.partner.contact_id,p_actor:a.user.id,p_path:storagePath,
    p_hash:crypto.createHash('sha256').update(pdf).digest('hex'),p_size:pdf.length,
    p_ip:request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()?.slice(0,100)||null,
    p_agent:request.headers.get('user-agent')?.slice(0,500)||null,
  });
  if(error){
    // Never delete on an ambiguous network/database outcome. A retry uses the
    // same immutable bytes. Only a confirmed competing submission is cleaned.
    if(error.message==='w9_already_submitted')await storage.remove([storagePath]);
    return w9DatabaseError(error);
  }
  return w9Json({ok:true},201);
}
