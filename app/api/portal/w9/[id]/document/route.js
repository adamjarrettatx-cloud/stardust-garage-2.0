import { w9Access,w9Json } from '@/lib/w9/server';
import { W9_UUID } from '@/lib/w9/form';
import { streamDocumentVersion } from '@/lib/document-helpers';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request,{params}){
  const a=await w9Access(request);if(a.response)return a.response;
  const {id}=await params;if(!W9_UUID.test(id))return w9Json({error:'Not found.'},404);
  const {data:s,error}=await a.admin.from('w9_submissions').select('document_id')
    .eq('id',id).eq('contact_id',a.partner.contact_id).maybeSingle();
  if(error||!s)return w9Json({error:'Not found.'},404);
  return streamDocumentVersion({admin:a.admin,documentId:s.document_id,inline:true,actor:a.user,request});
}
