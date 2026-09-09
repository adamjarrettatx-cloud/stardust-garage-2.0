// Guest Stardust-account welcome email — idempotent send.
//
// One shared entry point for every route that creates or completes a
// free_accounts row:
//
//   * app/api/free-account/create-no-verify/route.js
//       (ticket-checkout password signup)
//   * app/api/free-account/verify/check/route.js
//       (phone-verified trial-pass password signup)
//   * app/api/free-account/complete-profile/route.js
//   * app/api/free-account/complete-profile-no-verify/route.js
//       (Google OAuth — auth.users existed before, but the guest identity
//        as a Stardust account is only complete once free_accounts is
//        written; that's the moment to welcome them.)
//
// Why one function:
//
//   * The idempotency contract is a single UPDATE against
//     free_accounts.welcome_email_sent_at with an `IS NULL` predicate.
//     Because that predicate is atomic in Postgres, two concurrent callers
//     racing on the same user_id will see exactly one UPDATE return a row,
//     and only that caller will send. Duplicating this into each route
//     would be four ways to get the check wrong.
//
//   * Reconnect / re-upsert branches (existing user with a matching email,
//     retried OAuth complete-profile after a partial earlier signup) hit
//     the same helper and are auto-suppressed: the row's
//     welcome_email_sent_at is already set from the first successful send.
//
//   * Send failure is non-fatal to the calling route. Account creation
//     must NOT fail because of an email hiccup — the row is already
//     written, the browser session is already established, the user is in.
//     We log the failure loudly (matches the [free-account.*] prefix used
//     elsewhere in these routes) and leave welcome_email_sent_at NULL so
//     a later signup touch or a manual backfill can retry.
//
// Usage:
//
//   const admin = createAdminClient();
//   // ... upsert into free_accounts ...
//   await sendGuestAccountWelcomeOnce({
//     admin,
//     userId,
//     email: data.email_canonical || data.email,
//     fullName: data.full_name,
//   });
//   return NextResponse.json({ ok: true, userId });

import { sendGuestAccountWelcome } from '@/lib/email';

/**
 * Idempotently send the guest-account welcome email exactly once per user.
 *
 * @param {object} args
 * @param {import('@supabase/supabase-js').SupabaseClient} args.admin
 *   Service-role Supabase client (createAdminClient()). RLS on free_accounts
 *   would otherwise block this write from the anon key path.
 * @param {string} args.userId  auth.users.id of the account being created.
 * @param {string} args.email   Recipient address. Use the canonical form.
 * @param {string} [args.fullName]  Recipient's display name, first-name only
 *   in the greeting. Optional — falls back to "there" inside the template.
 * @returns {Promise<{ sent: boolean, reason?: string }>}
 *   Never throws. Callers should NOT await this in a way that blocks the
 *   signup response on the email network hop if latency becomes an issue,
 *   but a single Resend send is fast enough today to keep it inline.
 */
export async function sendGuestAccountWelcomeOnce({ admin, userId, email, fullName }) {
  if (!admin || !userId || !email) {
    return { sent: false, reason: 'missing_args' };
  }

  // Atomic claim: this returns the updated row ONLY if welcome_email_sent_at
  // was still NULL at the moment the UPDATE ran. If a concurrent request
  // already flipped it, or a previous signup for the same identity already
  // sent, `claimed` is an empty array and we return without sending.
  //
  // .select() forces the update to return the affected rows so we can tell
  // the winner branch from the loser branch. Without .select(), supabase-js
  // returns no data on success and we could not distinguish "0 rows matched"
  // from "1 row updated".
  const nowIso = new Date().toISOString();
  const { data: claimed, error: claimError } = await admin
    .from('free_accounts')
    .update({ welcome_email_sent_at: nowIso })
    .eq('user_id', userId)
    .is('welcome_email_sent_at', null)
    .select('user_id');

  if (claimError) {
    console.error('[free-account.send-welcome.claim]', claimError);
    return { sent: false, reason: 'claim_failed' };
  }
  if (!claimed || claimed.length === 0) {
    // Already sent (or the row does not exist — but the callers all upsert
    // free_accounts before calling us, so this branch is really the
    // reconnect / retry case). Nothing to do.
    return { sent: false, reason: 'already_sent' };
  }

  try {
    await sendGuestAccountWelcome({ email, fullName });
    return { sent: true };
  } catch (err) {
    // The claim already stamped welcome_email_sent_at, so a naive retry
    // would be suppressed. Roll the claim back so a future signup touch
    // (or a manual backfill) can try again cleanly.
    const { error: rollbackError } = await admin
      .from('free_accounts')
      .update({ welcome_email_sent_at: null })
      .eq('user_id', userId);
    if (rollbackError) {
      console.error('[free-account.send-welcome.rollback]', rollbackError);
    }
    console.error('[free-account.send-welcome.send]', err);
    return { sent: false, reason: 'send_failed' };
  }
}
