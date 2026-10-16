import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { sendDatePitchDecision } from '@/lib/email';
import { resolveSiteUrl } from '@/lib/site-url';
import { longDateLabel, pitchErrorResponse, PITCH_LIMITS } from '@/lib/date-pitches';

// Admin decisions run the RPC as the signed-in admin (the function checks
// is_admin() itself), then email every Programmer whose pitch changed.
export async function decidePitch(request, id, { approve, reason = null }) {
  const { unauthorized, reason: why } = await requireAdminMfa();
  if (unauthorized) return { status: 401, body: { error: 'Unauthorized', reason: why } };
  if (!approve && typeof reason === 'string' && reason.trim().length > PITCH_LIMITS.declineReason) {
    return { status: 400, body: { error: `Keep the note under ${PITCH_LIMITS.declineReason} characters.` } };
  }

  const supabase = await createClient();
  const admin = createAdminClient();
  const { data: pitch } = await admin.from('date_pitches').select('id, pitch_date, status').eq('id', id).maybeSingle();
  if (!pitch) return { status: 404, body: { error: 'Pitch not found.' } };
  const pendingBefore = approve
    ? (await admin.from('date_pitches').select('id').eq('pitch_date', pitch.pitch_date).eq('status', 'pending')).data || []
    : [{ id }];

  const { data, error } = approve
    ? await supabase.rpc('approve_date_pitch', { p_id: id })
    : await supabase.rpc('decline_date_pitch', { p_id: id, p_reason: reason || null });
  if (error) {
    const r = pitchErrorResponse(error);
    if (r.status === 500) console.error('[date pitches] decision failed', error.message);
    return { status: r.status, body: { error: r.error } };
  }
  if (!approve && !data) return { status: 409, body: { error: 'This pitch has already been decided.' } };

  const ids = pendingBefore.map((p) => p.id);
  const { data: changed } = ids.length
    ? await admin.from('date_pitches').select('id, email, full_name, title, pitch_date, status, decline_reason').in('id', ids)
    : { data: [] };
  const url = `${resolveSiteUrl(request)}/portal/pitches`;
  let emailed = 0;
  for (const row of changed || []) {
    if (!row.email || !['approved', 'declined'].includes(row.status)) continue;
    try {
      await sendDatePitchDecision({
        email: row.email, fullName: row.full_name, title: row.title,
        dateLabel: longDateLabel(row.pitch_date), approved: row.status === 'approved',
        reason: row.decline_reason, url,
      });
      emailed += 1;
    } catch (err) {
      console.error('[date pitches] decision email failed', err?.message || err);
    }
  }
  const autoDeclined = approve ? (changed || []).filter((r) => r.id !== id && r.status === 'declined').length : 0;
  return { status: 200, body: { ok: true, eventId: approve ? data : null, autoDeclined, emailed } };
}
