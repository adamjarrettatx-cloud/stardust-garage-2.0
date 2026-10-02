import type { SupabaseClient } from '@supabase/supabase-js';
import { notify } from '../notifications/send';
import { sendTrialPassApplicationInvite } from '../email';
import { daysRemaining, effectiveExpiry, formatPassDate } from '../trial-pass';

// Runs with Next's request-lifetime extension, after a successful transaction.
// A duplicate admission never schedules another notification or email.
export async function sendAdmissionFollowup(
  admin: SupabaseClient, kind: string, subjectId: string, eventId: string | null, activated: boolean,
) {
  if (kind === 'member') {
    const { data: member } = await admin.from('member_profiles').select('user_id').eq('id', subjectId).maybeSingle();
    if (member?.user_id) await notify(admin, {
      userId: member.user_id, type: 'door_checkin', title: 'You’re in',
      body: 'Welcome to Stardust Garage', data: { event_id: eventId, url: '/notifications' },
    });
    return;
  }
  const { data: pass } = await admin.from('trial_passes').select('*').eq('id', subjectId).maybeSingle();
  if (!pass) return;
  if (activated && pass.user_id) {
    await notify(admin, {
      userId: pass.user_id, type: 'trial_activated', title: 'Your trial has started',
      body: 'You have 30 days to explore Stardust Garage. Apply anytime from the members page.',
      data: { trial_pass_id: pass.id, url: '/members' },
    }).catch(() => {});
  }
  if (!pass.email || pass.applied_at || pass.converted_at) return;
  const { error } = await admin.from('trial_pass_emails').insert({
    trial_pass_id: pass.id, kind: 'application_invite', sequence: 0,
  });
  if (error) return; // unique claim prevents duplicate sends
  try {
    const expiry = effectiveExpiry(pass);
    const sent = await sendTrialPassApplicationInvite({
      email: pass.email, fullName: pass.full_name, applyUrl: 'https://www.sdgatx.com/members',
      passUrl: 'https://www.sdgatx.com/pass', daysLeft: daysRemaining(pass),
      expiresLabel: expiry ? formatPassDate(expiry) : '',
    });
    await admin.from('trial_pass_emails').update({ sent_at: new Date().toISOString(), provider_id: sent?.id || null })
      .eq('trial_pass_id', pass.id).eq('kind', 'application_invite').eq('sequence', 0);
  } catch {
    await admin.from('trial_pass_emails').delete().eq('trial_pass_id', pass.id)
      .eq('kind', 'application_invite').eq('sequence', 0).is('sent_at', null);
  }
}
