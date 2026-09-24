import { w9Access,w9Json } from '@/lib/w9/server';
export const runtime='nodejs';
export async function POST(request){
  const a=await w9Access(request,{write:true});if(a.response)return a.response;
  const {error}=await a.admin.from('w9_audit_log').insert({
    actor_id:a.user.id,contact_id:a.partner.contact_id,action:'form_opened',
    ip_address:request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()?.slice(0,100)||null,
    user_agent:request.headers.get('user-agent')?.slice(0,500)||null,
  });
  return error?w9Json({error:'Could not open the form. Please retry.'},503):w9Json({ok:true});
}
