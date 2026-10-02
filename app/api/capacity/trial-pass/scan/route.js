import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireFrontDeskOrTeam } from '@/lib/auth-helpers';
import { resolveDeviceFromToken } from '@/lib/capacity-device-auth';
import { extractDeviceToken } from '@/lib/capacity-device-utils';
import { fetchPriorDenials, fetchDoorSessionStart } from '@/lib/capacity/denial-lookup';
import { commitAdmission } from '@/lib/capacity/commit-admission';
import { daysRemaining, effectiveExpiry, evaluateDoorScan, formatPassDate, hashPassToken, isWellFormedPassToken, passStatusLabel } from '@/lib/trial-pass';
import { isValidRejectReason } from '@/lib/tickets/checkin';
import { buildTrialPassPreview } from '@/lib/tickets/trial-pass-preview';
import { findTrialPassLinkedTicket } from '@/lib/trial-pass-linked-ticket';
import { rateLimit, keyFromRequest } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const response = (body, status=200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

// Preview never mutates admission. Check-in always goes through the atomic
// pass + ticket + capacity transaction; no legacy optional-ticket branch.
export async function POST(request) {
  const url = new URL(request.url);
  const deviceToken = extractDeviceToken({
    authHeader: request.headers.get('authorization'), queryToken: url.searchParams.get('token'),
  });
  let staffUserId = null;
  let stationHash = null;
  let device = null;
  if (deviceToken) {
    device = await resolveDeviceFromToken(deviceToken);
    if (!device) return response({ error: 'Device not authorized' }, 401);
    if (device.role !== 'front_door') return response({ error: 'This device cannot admit guests.' }, 403);
  } else {
    const gate = await requireFrontDeskOrTeam(request);
    if (gate.unauthorized || !gate.user?.id) return response({ error: 'Unauthorized' }, 401);
    staffUserId = gate.user.id;
    stationHash = gate.station?.sessionHash || null;
  }
  const ipLimit = rateLimit({ key: keyFromRequest(request, 'trial_pass_scan'), limit: 300, windowMs: 60_000 });
  const credentialLimit = rateLimit({ key: `trial_pass_scan_credential:${device?.id || staffUserId}`, limit: 300, windowMs: 60_000 });
  if (!ipLimit.ok || !credentialLimit.ok) return response({ error: 'Too many scans', code: 'rate_limited' }, 429);
  const body = await request.json().catch(() => null);
  if (!body) return response({ error: 'Invalid JSON' }, 400);
  const passToken = typeof body.token === 'string' ? body.token.trim() : '';
  const mode = body.mode || 'preview';
  if (!['preview','checkin','reject'].includes(mode)) return response({ error: 'Invalid mode' }, 400);
  const eventId = UUID.test(body.eventId || '') ? body.eventId : null;
  const doorSessionId = UUID.test(body.door_session_id || '') ? body.door_session_id : null;
  if (!isWellFormedPassToken(passToken)) return response({ ok:false, result:'not_a_pass', reason:'That is not an SDG trial pass.' });
  const admin = createAdminClient();
  const { data: pass, error } = await admin.from('trial_passes')
    .select('id,user_id,full_name,email,status,issued_at,expires_at,extended_until,applied_at,converted_at,activated_at,signup_expires_at,profile_photo_path,member_profile_id')
    .eq('qr_token_hash', hashPassToken(passToken)).maybeSingle();
  if (error) return response({ error:'Pass lookup unavailable. Hold entry.' }, 503);
  if (!pass) return response({ ok:false, result:'not_a_pass', reason:'This pass is no longer valid.' });
  if (mode === 'checkin') {
    return commitAdmission(admin, {
      actorId:staffUserId, stationHash, deviceId:device?.id, kind:'trial_pass', subjectId:pass.id,
      tokenHash:hashPassToken(passToken), eventId, sessionId:doorSessionId, ticketCode:body.ticket_code,
    });
  }
  if (mode === 'reject') {
    if (!isValidRejectReason(body.reject_reason)) return response({ error:'Invalid reject reason' }, 400);
    let staffId = null;
    if (staffUserId && !stationHash) {
      const staff = await admin.from('team_members').select('id').eq('user_id', staffUserId).single();
      if (staff.error) return response({ error:'Staff lookup unavailable' }, 503);
      staffId = staff.data.id;
    }
    const { data, error: rejectError } = await admin.from('trial_pass_checkins').insert({
      trial_pass_id:pass.id, event_id:eventId, result:'rejected', reject_reason:body.reject_reason,
      checked_in_by:staffId, door_device_id:device?.id || null, door_session_id:doorSessionId,
      notes:typeof body.note === 'string' ? body.note.slice(0,280) : null,
    }).select('id').single();
    if (rejectError) return response({ error:'Rejection could not be recorded' }, 503);
    return response({ ok:false, mode:'reject', result:'rejected', reject_reason:body.reject_reason, checkin_id:data.id });
  }
  // MODE: preview. Missing/failed event context cannot imply admission.
  const { data: session, error: sessionError } = await admin.from('door_sessions')
    .select('id,event_id').is('closed_at',null).maybeSingle();
  if (sessionError) return response({ error:'Door session unavailable. Hold entry.' }, 503);
  if (!session || session.event_id !== eventId || (doorSessionId && session.id !== doorSessionId))
    return response({ error:'Start the correct door event before scanning.' }, 409);
  const { data:event, error:eventError } = await admin.from('events')
    .select('id,title,event_date,is_weekend_music_experience').eq('id',eventId).single();
  if (eventError) return response({ error:'Event unavailable. Hold entry.' }, 503);
  const { count, error:dupeError } = await admin.from('trial_pass_checkins')
    .select('id',{count:'exact',head:true}).eq('trial_pass_id',pass.id).eq('event_id',eventId).eq('result','allowed');
  if (dupeError) return response({ error:'Previous admission lookup unavailable. Hold entry.' }, 503);
  const decision = evaluateDoorScan({pass,event,alreadyCheckedIn:(count || 0)>0});
  const preview = await buildTrialPassPreview(admin,pass);
  const linkedTicket = decision.allowed ? await findTrialPassLinkedTicket(admin,{
    passMemberProfileId:pass.member_profile_id, passEmail:pass.email, eventId,
  }) : {ticket:null};
  let priorDenials=[];
  let sessionStartedAt=null;
  try {
    [priorDenials,sessionStartedAt]=await Promise.all([
      fetchPriorDenials(admin,{kind:'trial_pass',trialPassId:pass.id}),fetchDoorSessionStart(admin,session.id),
    ]);
  } catch { /* Historical notes are advisory; commit rechecks restrictions. */ }
  const expiry=effectiveExpiry(pass);
  return response({
    access_subject:{kind:'trial_pass',id:pass.id}, mode:'preview', ok:decision.allowed,
    result:decision.result, reason:decision.reason, staffAction:decision.staffAction || null,
    prior_denials:priorDenials, session_started_at:sessionStartedAt,
    guest:{passId:pass.id,fullName:staffUserId ? pass.full_name : null,firstName:preview.firstName,
      statusLabel:passStatusLabel(pass),expiresLabel:expiry ? formatPassDate(expiry) : null,
      daysLeft:daysRemaining(pass),hasPhoto:preview.hasPhoto,photoSignedUrl:preview.photoSignedUrl},
    event:{id:event.id,title:event.title,date:event.event_date},
    linked_ticket:linkedTicket.ticket ? {
      ticket_id:linkedTicket.ticket.id,ticket_code:linkedTicket.ticket.ticket_code,
      product_label:linkedTicket.productLabel,matched_via:linkedTicket.matchedVia,candidate_count:linkedTicket.candidateCount,
    } : null,
  });
}
