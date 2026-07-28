// Signups-only lifecycle: new → seen. Signups are a passive email/text
// subscriber list, so loading the admin page acknowledges everything that was
// still new. This is deliberately separate from the shared submission status
// workflow (lib/submission-status.js) so no 'seen' transition is ever exposed
// to the other four submission types.

async function defaultCreateAdminClient() {
  const mod = await import('./supabase/admin.js');
  return mod.createAdminClient();
}

// Idempotent by construction: the filter only matches rows still at 'new', so
// re-running it (double render, refresh, concurrent loads) has nothing to do.
export async function markNewSignupsSeen({ createAdminClient = defaultCreateAdminClient } = {}) {
  try {
    const supabase = await createAdminClient();
    const { error } = await supabase
      .from('signups')
      .update({ status: 'seen' })
      .eq('status', 'new');

    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || 'Could not mark signups as seen.' };
  }
}
