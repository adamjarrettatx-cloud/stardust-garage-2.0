import { after, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { restrictionGuard } from './access-restrictions';
import { normalizeTicketCode } from '../tickets/codes';

type AdmissionInput = {
  actorId?: string | null; deviceId?: string | null;
  stationHash?: string | null;
  kind: 'member' | 'trial_pass'; subjectId: string; tokenHash: string;
  eventId: string | null; sessionId: string | null; ticketCode?: unknown;
};

export async function commitAdmission(admin: SupabaseClient, input: AdmissionInput) {
  // Never trust a prior preview, pass->ticket pairing or UI eligibility flag.
  const blocked = await restrictionGuard(admin, { kind: input.kind, id: input.subjectId });
  if (blocked) return blocked;
  const ticketCode = input.ticketCode == null ? null : normalizeTicketCode(input.ticketCode);
  if (input.ticketCode != null && !ticketCode) {
    return NextResponse.json({ error: 'Invalid group ticket code.' }, { status: 400 });
  }
  const { data, error } = await admin.rpc('commit_door_admission', {
    p_actor: input.actorId || null, p_device: input.deviceId || null,
    p_kind: input.kind, p_subject: input.subjectId, p_token_hash: input.tokenHash,
    p_event: input.eventId, p_session: input.sessionId, p_ticket_code: ticketCode,
    p_station_hash: input.stationHash || null,
  });
  if (error) {
    const policy = error.code === 'P0001' || error.code === '42501';
    return NextResponse.json({
      ok: false, code: 'admission_denied',
      error: policy ? error.message : 'Admission could not be confirmed. Hold entry and retry.',
    }, { status: policy ? 409 : 503, headers: { 'Cache-Control': 'no-store' } });
  }
  if (!data?.ok) {
    return NextResponse.json({ ...data, error: data?.reason || 'Entry not confirmed.' },
      { status: 409, headers: { 'Cache-Control': 'no-store' } });
  }
  after(async () => {
    try {
      const { sendAdmissionFollowup } = await import('./admission-followup');
      await sendAdmissionFollowup(admin, input.kind, input.subjectId, input.eventId, data.trial_activated);
    } catch (error) {
      console.error('[admission.followup]', error instanceof Error ? error.message : 'failed');
    }
  });
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
}
