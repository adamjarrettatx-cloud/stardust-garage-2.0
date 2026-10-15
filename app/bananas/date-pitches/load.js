import { createAdminClient } from '@/lib/supabase/admin';

// Adds the two facts a reviewer needs before approving: whether another
// Programmer pitched the same date, and whether the date has since been filled
// by an event or an internal calendar entry.
export async function withConflicts(pitches) {
  const pendingDates = [...new Set(pitches.filter((p) => p.status === 'pending').map((p) => p.pitch_date))];
  if (!pendingDates.length) return pitches.map((p) => ({ ...p, otherPending: 0, dateTaken: false }));
  const admin = createAdminClient();
  const [pending, events, holds] = await Promise.all([
    admin.from('date_pitches').select('id, pitch_date').eq('status', 'pending').in('pitch_date', pendingDates),
    admin.from('events').select('event_date').in('event_date', pendingDates),
    admin.from('team_events').select('event_date').in('event_date', pendingDates),
  ]);
  const taken = new Set([...(events.data || []), ...(holds.data || [])].map((r) => r.event_date));
  return pitches.map((p) => ({
    ...p,
    otherPending: p.status === 'pending' ? (pending.data || []).filter((x) => x.pitch_date === p.pitch_date && x.id !== p.id).length : 0,
    dateTaken: p.status === 'pending' && taken.has(p.pitch_date),
  }));
}

export const PITCH_COLUMNS = 'id, contact_id, full_name, email, pitch_date, title, concept, lineup, start_time, end_time, expected_attendance, notes, status, decline_reason, event_id, decided_at, created_at, contacts(display_name, photo_url)';
