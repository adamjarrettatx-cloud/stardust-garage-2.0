import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createProfilePhotoSignedUrl } from '@/lib/profile-photo';
import { buildAccountProfile } from '@/lib/account-profile';
import { isRestrictedStaffRole } from '@/lib/partner-access';

// React cache deduplicates within this request, never across signed-in users.
export const getAccountProfile = cache(async () => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/account/profile');
  const admin = createAdminClient();
  const results = await Promise.all([
    admin.from('free_accounts').select('full_name,phone,phone_verified_at,profile_photo_path').eq('user_id', user.id).maybeSingle(),
    admin.from('member_profiles').select('id,full_name,is_active,subscription_status,subscription_plan').eq('user_id', user.id).maybeSingle(),
    admin.from('trial_passes').select('status,activated_at,expires_at,extended_until,signup_expires_at').eq('user_id', user.id).order('issued_at', { ascending: false }).limit(5),
    supabase.from('team_members').select('role').eq('user_id', user.id).maybeSingle(),
    supabase.rpc('partner_self'),
  ]);
  // Don't misrepresent a failed permission/status lookup as an ordinary free account.
  if (results.some((result) => result.error)) throw new Error('Your profile could not be loaded. Please try again.');
  const [freeResult, memberResult, trialResult, teamResult, partnerResult] = results;
  const personal = freeResult.data || {};
  const member = memberResult.data;
  const teamRole = teamResult.data?.role || null;
  const partner = Array.isArray(partnerResult.data) ? partnerResult.data[0] : partnerResult.data;
  let resources = {};
  if (partner?.is_active === true && !isRestrictedStaffRole(teamRole)) {
    const reads = await Promise.all(['partner_grants', 'partner_bookings', 'partner_contracts'].map((rpc) => supabase.rpc(rpc)));
    if (reads.some((result) => result.error)) throw new Error('Your workspaces could not be loaded. Please try again.');
    resources = { grants: reads[0].data || [], bookings: reads[1].data || [], contracts: reads[2].data || [] };
  }
  const photo = await createProfilePhotoSignedUrl(admin, personal.profile_photo_path);
  return {
    name: personal.full_name || member?.full_name || partner?.full_name || user.user_metadata?.full_name || '',
    email: user.email || '',
    phone: personal.phone || '',
    phoneVerified: Boolean(personal.phone_verified_at),
    photoUrl: photo?.signedUrl || null,
    partner: partner ? {
      fullName: partner.full_name || '', photoUrl: partner.photo_url || '',
      contactDisplayName: partner.contact_display_name || '', invitedAt: partner.invited_at || null,
    } : null,
    contactType: partner?.contact_type || [],
    ...buildAccountProfile({ member, passes: trialResult.data || [], partner, teamRole, resources }),
  };
});
