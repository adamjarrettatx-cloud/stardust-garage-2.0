import type { SupabaseClient } from '@supabase/supabase-js';
import { shiftWindow } from './arrival-roster';

export type IncidentAction = 'warning' | 'final_warning' | 'review' | 'ban';
export type IncidentCategory = 'photography' | 'altercation' | 'harassment' | 'other';
export { INCIDENT_ACTIONS, INCIDENT_CATEGORIES } from './security-labels';
export interface SecurityIncident {
  id: string; action: IncidentAction; category: IncidentCategory; note: string;
  actor_label: string; created_at: string; event_id: string | null; restriction_id: string | null;
}
export async function securityHistory(admin: SupabaseClient, keys: string[]) {
  const { data, error } = await admin.from('security_incidents')
    .select('id,action,category,note,actor_label,created_at,event_id,restriction_id')
    .overlaps('identity_keys', keys).order('created_at', { ascending: false }).limit(1000);
  if (error || !data || data.length >= 1000) throw new Error('Incident history unavailable.');
  const incidents = data as SecurityIncident[];
  const warnings = incidents.filter(row => row.action === 'warning' || row.action === 'final_warning');
  if (!warnings.length) return { incidents, pending_reminders: [] as SecurityIncident[] };
  const { data: reminders, error: reminderError } = await admin.from('security_warning_reminders')
    .select('incident_ids,actor_label,created_at').overlaps('identity_keys', keys)
    .eq('shift_day', shiftWindow().shiftDay).limit(1000);
  if (reminderError || !reminders || reminders.length >= 1000) throw new Error('Rule reminders unavailable.');
  const acknowledged = new Set(reminders.flatMap(row => row.incident_ids as string[]));
  return { incidents, pending_reminders: warnings.filter(row => !acknowledged.has(row.id)) };
}
