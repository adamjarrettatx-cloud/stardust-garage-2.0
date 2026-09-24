import { w9Access,w9Json,w9DatabaseError } from '@/lib/w9/server';
import { W9_UUID } from '@/lib/w9/form';
export const runtime='nodejs';
export async function POST(request,{params}){
  const a=await w9Access(request,{reviewer:true,write:true});if(a.response)return a.response;
  const {id}=await params;if(!W9_UUID.test(id))return w9Json({error:'Not found.'},404);
  const body=await request.json().catch(()=>null);
  if(!body||Object.keys(body).some(k=>!['decision','reason','confirmed'].includes(k))
    ||!['approved','denied'].includes(body.decision)||body.confirmed!==true)
    return w9Json({error:'Review the submitted W-9 and confirm your decision.'},400);
  const reason=typeof body.reason==='string'?body.reason.trim():'';
  if(body.decision==='denied'&&(!reason||reason.length>1000))
    return w9Json({error:'Enter a reason between 1 and 1,000 characters.'},400);
  // Keep taxpayer identifiers out of free-text review comments and alerts.
  if(/\d{3}[- ]?\d{2}[- ]?\d{4}|\d{2}[- ]?\d{7}/.test(reason))
    return w9Json({error:'Do not include taxpayer identification numbers in the comment.'},400);
  const {error}=await a.admin.rpc('review_artist_w9',{
    p_id:id,p_actor:a.user.id,p_decision:body.decision,p_reason:body.decision==='denied'?reason:null,
  });
  return error?w9DatabaseError(error):w9Json({ok:true});
}
