import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireFrontDeskOrTeam } from '@/lib/auth-helpers';
import { isTicketScannerEnabled, isInternalTicketingEnabled } from '@/lib/feature-flags';
import { rateLimit, keyFromRequest } from '@/lib/rate-limit';
import { normalizeTicketCode } from '@/lib/tickets/codes';
import { validateTicketScan, isValidRejectReason } from '@/lib/tickets/checkin';
import { buildBuyerPreview } from '@/lib/tickets/buyer-preview';
import { fetchPriorDenials, fetchDoorSessionStart } from '@/lib/capacity/denial-lookup';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const response=(body,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});

// Ticket scan prepares a group ticket; it does not identify the actual guest.
// Admission must use the guest's member/trial endpoint with this ticket code.
export async function POST(request) {
  if (!isInternalTicketingEnabled() || !isTicketScannerEnabled()) return response({error:'Scanner disabled'},404);
  const gate=await requireFrontDeskOrTeam(request);
  if (gate.unauthorized || !gate.user?.id) return response({error:'Unauthorized'},401);
  if (!rateLimit({key:keyFromRequest(request,'ticket_scan'),limit:300,windowMs:60_000}).ok)
    return response({error:'Too many scans'},429);
  const body=await request.json().catch(()=>null);
  if (!body) return response({error:'Invalid JSON'},400);
  const mode=body.mode || 'preview';
  if (mode==='checkin') return response({
    error:'Scan this guest’s own My Pass QR to validate their pass and redeem this ticket together.',
    code:'guest_pass_required',
  },409);
  if (!['preview','reject'].includes(mode)) return response({error:'Invalid mode'},400);
  const code=normalizeTicketCode(body.code);
  const eventId=body.event_id;
  if (!code || !eventId) return response({error:'Missing code or event_id'},400);
  if (mode==='reject' && !isValidRejectReason(body.reject_reason)) return response({error:'Invalid reject reason'},400);
  const admin=createAdminClient();
  const {data:ticket,error}=await admin.from('tickets')
    .select('id,order_id,event_id,product_id,status,used_at').eq('ticket_code',code).maybeSingle();
  if (error) return response({error:'Ticket lookup unavailable. Hold entry.'},503);
  const decision=validateTicketScan({ticket,eventId});
  if (mode==='reject') {
    const {data,error:logError}=await admin.from('ticket_checkins').insert({
      ticket_id:ticket?.id || null,event_id:eventId,ticket_code_attempted:code,result:'rejected',
      reject_reason:body.reject_reason,scanned_by:gate.user.id,
      door_session_id:body.door_session_id || null,
      device_label:typeof body.device_label==='string' ? body.device_label.slice(0,120) : null,
      note:typeof body.note==='string' ? body.note.slice(0,280) : null,
    }).select('id').single();
    if (logError) return response({error:'Rejection could not be recorded'},503);
    return response({mode,result:'rejected',reject_reason:body.reject_reason,checkin_id:data.id});
  }
  const buyer=await buildBuyerPreview(admin,ticket);
  let priorDenials=[];
  let sessionStartedAt=null;
  try {
    [priorDenials,sessionStartedAt]=await Promise.all([
      ticket ? fetchPriorDenials(admin,{kind:'ticket',ticketId:ticket.id}) : [],
      fetchDoorSessionStart(admin,body.door_session_id || null),
    ]);
  } catch { /* Advisory buyer history; actual guest is checked on pass commit. */ }
  return response({mode:'preview',result:decision.result,reason:decision.reason,
    access_subject:ticket ? {kind:'ticket',id:ticket.id} : null,
    ticket:ticket ? {id:ticket.id,status:ticket.status,used_at:ticket.used_at} : null,
    buyer,prior_denials:priorDenials,session_started_at:sessionStartedAt,guest_pass_required:true});
}
