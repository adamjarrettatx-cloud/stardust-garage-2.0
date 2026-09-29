import type { SupabaseClient } from '@supabase/supabase-js';
import { createProfilePhotoSignedUrl } from '@/lib/profile-photo';
type Subject = { kind: 'member' | 'trial_pass' | 'guest'; id: string };
const TABLES = {
  member: ['member_profiles', 'id,full_name,user_id,profile_photo_path,photo_url'],
  trial_pass: ['trial_passes', 'id,full_name,user_id,profile_photo_path'],
  guest: ['guest_profiles', 'id,full_name'],
} as const;
// Security identity lookup must work independently of attendance capacity,
// admission eligibility, or the size of tonight's roster.
export async function loadSecurityProfile(admin: SupabaseClient, subject: Subject, identityKeys: string[]) {
  const [table, columns] = TABLES[subject.kind];
  const { data: raw, error } = await admin.from(table).select(columns).eq('id', subject.id).maybeSingle();
  if (error || !raw) throw new Error('Guest profile unavailable.');
  const row = raw as unknown as { full_name?: string; user_id?: string; profile_photo_path?: string; photo_url?: string };
  const users = identityKeys.filter(key => key.startsWith('user:')).map(key => key.slice(5));
  let path = row.profile_photo_path || null;
  if (users.length) {
    const { data, error: accountError } = await admin.from('free_accounts')
      .select('user_id,profile_photo_path').in('user_id', users).limit(1000);
    if (accountError || !data) throw new Error('Account photo lookup unavailable.');
    path = data.find(account => account.user_id === row.user_id)?.profile_photo_path
      || data.find(account => account.profile_photo_path)?.profile_photo_path || path;
  }
  const signed = path ? await createProfilePhotoSignedUrl(admin, path) : null;
  return { full_name: row.full_name || 'Guest', photo_url: signed?.signedUrl || row.photo_url || null };
}
