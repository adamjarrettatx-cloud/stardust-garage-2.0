import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminMfa, requirePartner } from '@/lib/auth-helpers';
import { isContractorContact } from '@/lib/contact-helpers';
import { isSameOrigin } from '@/lib/manual-income';
import { parseBearerToken } from '@/lib/request-auth';

export const W9_HEADERS={'Cache-Control':'private, no-store, max-age=0','Referrer-Policy':'no-referrer'};
export const W9_SAFE_COLUMNS='id,contact_id,document_id,status,created_at,reviewed_at,reviewed_by,rejection_reason';
export const w9Json=(data,status=200)=>Response.json(data,{status,headers:W9_HEADERS});
export async function w9Enabled(admin) {
  const {data,error}=await admin.rpc('w9_enabled');
  if(error)throw new Error('w9_unavailable');
  return data===true;
}
export async function isW9Reviewer(admin,userId) {
  const {data,error}=await admin.rpc('w9_actor_is_reviewer',{p_actor:userId});
  return !error&&data===true;
}
export function validW9Origin(request){
  // Mobile bearer requests have no ambient browser cookie authentication.
  return Boolean(parseBearerToken(request.headers.get('authorization'))&&!request.headers.get('origin'))
    || Boolean(request.headers.get('origin')&&isSameOrigin(request.headers.get('origin'),new URL(request.url).host));
}
export async function w9Access(request,{reviewer=false,write=false}={}) {
  const auth=reviewer?await requireAdminMfa():await requirePartner(request);
  if(auth.unauthorized)return {response:w9Json({error:'Sign in with an authorized account.',reason:auth.reason},401)};
  if(write&&!validW9Origin(request))return {response:w9Json({error:'Cross-origin request rejected.'},403)};
  const admin=createAdminClient();
  if(reviewer&&!await isW9Reviewer(admin,auth.user.id))return {response:w9Json({error:'W-9 review is restricted to Adam, Jeyu, and Naish.'},403)};
  if(!reviewer&&(!isContractorContact(auth.partner?.contact_type)||!auth.partner?.activated_at
      ||!auth.partner?.full_name?.trim()||!auth.partner?.photo_url))
    return {response:w9Json({error:'Complete your artist profile before submitting a W-9.'},403)};
  try{if(!await w9Enabled(admin))return {response:w9Json({error:'W-9 onboarding is not enabled yet.'},503)}}
  catch{return {response:w9Json({error:'W-9 onboarding is temporarily unavailable.'},503)}}
  return {...auth,admin};
}
export async function loadW9History(admin,contactId){
  const {data,error}=await admin.from('w9_submissions').select(W9_SAFE_COLUMNS)
    .eq('contact_id',contactId).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(50);
  if(error)throw new Error('w9_unavailable');
  return data||[];
}
export async function w9BookingCheck(admin,contactId) {
  try{
    if(!await w9Enabled(admin))return null;
    const {data,error}=await admin.rpc('w9_has_approval',{p_contact:contactId});
    if(error)return w9Json({error:'Could not verify W-9 approval. Try again.'},503);
    if(data!==true)return w9Json({error:'This artist needs an approved W-9 before booking or requesting pay.'},409);
    return null;
  }catch{return w9Json({error:'Could not verify W-9 approval. Try again.'},503)}
}
export async function taxDocumentAccess(admin,userId,documentId,{write=false}={}){
  const {data:doc,error}=await admin.from('documents').select('id,category').eq('id',documentId).maybeSingle();
  if(error||!doc)return false;
  if(doc.category!=='tax')return true;
  if(write){
    const {data:submission,error:lookup}=await admin.from('w9_submissions').select('id').eq('document_id',documentId).maybeSingle();
    if(lookup||submission)return false;
    return isW9Reviewer(admin,userId);
  }
  if(await isW9Reviewer(admin,userId))return true;
  const {data:partner,error:partnerError}=await admin.from('partner_profiles')
    .select('contact_id').eq('user_id',userId).eq('is_active',true).maybeSingle();
  if(partnerError||!partner)return false;
  const {data:submission,error:lookup}=await admin.from('w9_submissions').select('id')
    .eq('document_id',documentId).eq('contact_id',partner.contact_id).maybeSingle();
  return !lookup&&Boolean(submission);
}
// A template or other mutable metadata pointer must never be used to read,
// copy, transmit or delete a tax object through a different service-role API.
export async function nonTaxStorageCheck(admin,storagePath){
  const {data,error}=await admin.rpc('w9_is_tax_object',{p_name:storagePath});
  if(error)return w9Json({error:'Could not verify secure file access.'},503);
  return data===false?null:w9Json({error:'Tax files cannot be used through this file operation.'},403);
}
export function w9DatabaseError(error){
  const message=error?.message||'';
  const known={
    w9_already_submitted:'A W-9 is already pending or approved. Refresh your profile.',
    w9_already_reviewed:'This submission was already reviewed. Refresh before continuing.',
    w9_reason_required:'A reason is required when denying a W-9.',
    w9_artist_required:'Complete your artist profile first.',
    w9_reviewer_required:'W-9 reviewer access required.',
    w9_disabled:'W-9 onboarding is not enabled yet.',
  };
  return w9Json({error:known[message]||'Could not complete the W-9 operation. Refresh your profile before retrying.'},known[message]?409:503);
}
