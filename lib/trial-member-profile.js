// Trial pass \u2194 guest_profiles linking.
//
// When a trial pass is issued (new or reissued), we want a matching row in
// guest_profiles so this person shows up in the venue's canonical guest list
// with profile_status = 'trial_member'. This is what turns a name inside the
// trial_passes silo into a first-class member of the guest database.
//
// The match-or-create is deliberately app-side, not a DB unique constraint:
// existing guest_profiles rows were created by name-only matching from the
// door flow, and imposing email/phone uniqueness across the whole table would
// either fail on legacy data or collapse two people who share a placeholder.
//
// Match order:
//   1. Email (case-insensitive) \u2014 the strongest identity signal here.
//   2. Phone \u2014 second-strongest, catches guests who typed a different email.
//   3. If neither hits, create a new guest_profiles row.
//
// Every path returns the guest_profiles.id so the caller can write it onto
// the trial_passes row.
//
// The status transition is one-way "forward": we only escalate status. We
// never overwrite 'member' or 'applicant' or 'former_member' with the
// trial-side 'trial_member', because a real member with a lapsed membership
// coming back for a fresh trial should still register as 'member' in the DB.
// Rank is defined by TRIAL_MEMBER_STATUS_RANK below.

// Lazy-imported inside the function so the exported constants can be pulled
// into unit tests without a bundler.
// import { createAdminClient } from '@/lib/supabase/admin';

// Ordinal ranking of profile_status values \u2014 higher wins. A trial signup
// bumps a 'guest' up to 'trial_member' but never demotes an existing member.
export const TRIAL_MEMBER_STATUS_RANK = {
  guest: 0,
  trial_expired: 1,
  trial_member: 2,
  applicant: 3,
  former_member: 3, // same rank: neither a former member nor an applicant should be demoted by the other
  member: 4,
};

export const TRIAL_MEMBER_STATUS = 'trial_member';

// Match-or-create a guest_profiles row for a trial pass. Returns the profile
// id, or null on error (logged, not thrown \u2014 the pass issue is the critical
// path and profile linking is enrichment that must never block it).
export async function linkTrialMemberProfile({
  full_name,
  email,
  phone,
  admin: injectedAdmin,
} = {}) {
  if (!full_name || (!email && !phone)) return null;
  let admin = injectedAdmin;
  if (!admin) {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    admin = createAdminClient();
  }

  try {
    // 1. Try to match on email (case-insensitive).
    let matched = null;
    if (email) {
      const { data, error } = await admin
        .from('guest_profiles')
        .select('id, profile_status, phone, email')
        .ilike('email', email)
        .limit(1)
        .maybeSingle();
      if (error) {
        console.error('[trial-member-profile.match.email]', error);
      } else if (data) {
        matched = data;
      }
    }

    // 2. Fall back to phone.
    if (!matched && phone) {
      const { data, error } = await admin
        .from('guest_profiles')
        .select('id, profile_status, phone, email')
        .eq('phone', phone)
        .limit(1)
        .maybeSingle();
      if (error) {
        console.error('[trial-member-profile.match.phone]', error);
      } else if (data) {
        matched = data;
      }
    }

    if (matched) {
      // 3. Existing profile \u2014 fill in any missing contact fields, and
      //    escalate status if warranted (never demote).
      const patch = {};
      if (!matched.email && email) patch.email = email;
      if (!matched.phone && phone) patch.phone = phone;

      const currentRank = TRIAL_MEMBER_STATUS_RANK[matched.profile_status] ?? 0;
      const trialRank = TRIAL_MEMBER_STATUS_RANK[TRIAL_MEMBER_STATUS];
      if (currentRank < trialRank) {
        patch.profile_status = TRIAL_MEMBER_STATUS;
      }

      if (Object.keys(patch).length > 0) {
        const { error: updateError } = await admin
          .from('guest_profiles')
          .update(patch)
          .eq('id', matched.id);
        if (updateError) {
          console.error('[trial-member-profile.update]', updateError);
          // Still return the id \u2014 the link is valuable even if the enrichment failed.
        }
      }
      return matched.id;
    }

    // 4. No match \u2014 create a new profile as a trial_member.
    const { data: created, error: insertError } = await admin
      .from('guest_profiles')
      .insert({
        full_name,
        email: email || null,
        phone: phone || null,
        profile_status: TRIAL_MEMBER_STATUS,
        marketing_consent: false, // conservative default; captured elsewhere if the guest opts in
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('[trial-member-profile.insert]', insertError);
      return null;
    }

    return created.id;
  } catch (err) {
    console.error('[trial-member-profile.unexpected]', err?.message || err);
    return null;
  }
}
