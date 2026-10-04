import { ensureTrialPassAccount } from './trial-pass-account.js';

// Account sweep for Trial SDG Passes.
//
// Every pass should carry user_id: the ticket discount and the profile QR are
// both keyed on it. Issuance now creates or links the account inline, but
// that is best-effort around a guest waiting at the door, and ~1,100 passes
// were issued before it existed. This links or creates the account for any
// pass still missing one, quietly: no email is sent (createUser with
// email_confirm does not mail, and no magic link is generated).
//
// Rules:
//   * Backfill only — the update is guarded by `user_id is null`, so a pass
//     linked meanwhile (by the guest signing in, or by issuance) is untouched.
//   * Existing accounts are linked, never modified (ensureTrialPassAccount).
//   * A pass that fails is stamped with the error and not retried for
//     RETRY_AFTER_MS, so one bad address cannot eat every run.
//   * Never throws per pass; returns counts for the cron response.

export const SWEEP_BATCH = 100;
export const RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

export async function sweepUnlinkedTrialPasses(admin, { limit = SWEEP_BATCH, now = new Date() } = {}) {
  const retryBefore = new Date(now.getTime() - RETRY_AFTER_MS).toISOString();
  const { data: passes, error } = await admin
    .from('trial_passes')
    .select('id, email, full_name')
    .is('user_id', null)
    .or(`account_link_attempted_at.is.null,account_link_attempted_at.lt.${retryBefore}`)
    .order('issued_at', { ascending: false })
    .limit(limit);
  if (error) throw error;

  const result = { scanned: passes?.length || 0, created: 0, linkedExisting: 0, failed: 0 };
  for (const pass of passes || []) {
    const account = await ensureTrialPassAccount(admin, { email: pass.email, fullName: pass.full_name });
    const stamp = { account_link_attempted_at: now.toISOString() };
    if (account.userId) {
      const { data: updated, error: linkError } = await admin
        .from('trial_passes')
        .update({ ...stamp, user_id: account.userId, account_link_error: null })
        .eq('id', pass.id)
        .is('user_id', null)
        .select('id');
      if (linkError) {
        result.failed += 1;
        await admin.from('trial_passes')
          .update({ ...stamp, account_link_error: String(linkError.message || linkError).slice(0, 500) })
          .eq('id', pass.id);
        continue;
      }
      if (updated?.length) {
        if (account.created) result.created += 1;
        else result.linkedExisting += 1;
      }
    } else {
      result.failed += 1;
      await admin.from('trial_passes')
        .update({ ...stamp, account_link_error: String(account.error || 'not_linked').slice(0, 500) })
        .eq('id', pass.id);
    }
  }
  return result;
}
