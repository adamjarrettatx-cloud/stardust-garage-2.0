import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/stub';
import { resolveSiteUrl } from '@/lib/site-url';
import { sendTrialPassReminder } from '@/lib/email';
import {
  MAX_REMINDERS,
  formatPassDate,
  needsExpiryFlip,
  reminderDueFor,
} from '@/lib/trial-pass';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/cron/trial-pass-reminders
//
// Daily Vercel cron. Two jobs, in this order:
//
//   1. Nudge. Every open trial pass gets a reminder on days 6, 12, 18 and 24 of
//      its 30-day window, and stops the moment the guest applies. The schedule
//      is decided by reminderDueFor() in lib/trial-pass.js — the same module
//      the door uses to decide whether a pass is live — so a guest can never be
//      chased about a pass the door would have rejected.
//
//   2. Close the window. Passes whose expiry has passed but whose status still
//      says 'active'/'extended' are flipped to 'expired', so the admin list and
//      the door lookup agree without every reader re-deriving it.
//
// Idempotent by construction. Each send is CLAIMED in trial_pass_emails under
// the unique index on (trial_pass_id, kind, sequence) BEFORE Resend is called;
// a retried or double-scheduled run loses that insert and skips the send rather
// than mailing a guest twice. Runs deliberately separate from
// /api/cron/send-discount-codes: a Resend outage that breaks the nudge sequence
// must not also stop members getting their event codes.
export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });
  }

  const admin = createAdminClient();
  const siteUrl = resolveSiteUrl(request);
  const now = new Date();

  try {
    // The candidate set: windows still marked open, and nobody who has already
    // had all four nudges. Narrow enough to stay a single query as the trial
    // program grows, and the per-pass schedule check happens in JS where it is
    // unit tested.
    const { data: candidates, error: loadError } = await admin
      .from('trial_passes')
      .select(
        'id, full_name, email, status, issued_at, expires_at, extended_until, ' +
          'activated_at, signup_expires_at, ' +
          'applied_at, converted_at, reminders_sent, qr_token_hash',
      )
      .in('status', ['active', 'extended'])
      // Widen the SQL prefilter to the higher of the two ceilings so
      // unactivated passes (max 3 nudges) and activated passes (max 4)
      // both make it through. reminderDueFor() then applies the correct
      // per-phase cap in JS.
      .lt('reminders_sent', MAX_REMINDERS)
      .is('applied_at', null)
      .is('converted_at', null);

    if (loadError) {
      throw new Error(`Failed to load trial passes: ${loadError.message}`);
    }

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const pass of candidates || []) {
      const due = reminderDueFor(pass, now);
      if (!due.due) {
        skipped++;
        continue;
      }

      // Claim the send. A unique violation (23505) means another run already
      // has this nudge — that is a success for us, not an error.
      const { error: claimError } = await admin.from('trial_pass_emails').insert({
        trial_pass_id: pass.id,
        kind: 'reminder',
        sequence: due.sequence,
      });
      if (claimError) {
        if (claimError.code !== '23505') {
          console.error('[cron.trial-pass-reminders.claim]', pass.id, claimError);
          failed++;
        } else {
          skipped++;
        }
        continue;
      }

      try {
        // The reminder links to /pass, not to /pass/<token>. It cannot link to
        // the token: only the SHA-256 hash of it is stored, which is the whole
        // point of hashing it — a leaked database row does not hand anybody a
        // working pass. What /pass does instead is recognise a returning email
        // and re-issue the same pass with a fresh token, so "tap the link,
        // type your email, your pass is back" is a complete recovery path
        // without us ever holding a replayable credential.
        // Two very different template calls depending on activation:
        //   activation_nudge — pass has never been used; expiresLabel is the
        //     signup_expires_at deadline (activate by...).
        //   application_nudge — pass activated; expiresLabel is the actual
        //     30-day (or extended) expiry date.
        const expiresLabelSource =
          due.kind === 'activation_nudge'
            ? pass.signup_expires_at
            : pass.extended_until || pass.expires_at;
        const result = await sendTrialPassReminder({
          email: pass.email,
          fullName: pass.full_name,
          passUrl: `${siteUrl}/pass`,
          applyUrl: `${siteUrl}/members`,
          daysLeft: due.daysLeft,
          expiresLabel: formatPassDate(expiresLabelSource),
          kind: due.kind,
        });

        const sentAt = new Date().toISOString();
        await admin
          .from('trial_pass_emails')
          .update({ sent_at: sentAt, provider_id: result?.id || null })
          .eq('trial_pass_id', pass.id)
          .eq('kind', 'reminder')
          .eq('sequence', due.sequence);

        // reminders_sent is set to the sequence just sent, not incremented:
        // assignment is idempotent where `+= 1` would drift if this line ever
        // ran twice for the same nudge.
        await admin
          .from('trial_passes')
          .update({ reminders_sent: due.sequence, last_reminder_at: sentAt })
          .eq('id', pass.id);

        sent++;
      } catch (err) {
        console.error('[cron.trial-pass-reminders.send]', pass.id, err?.message || err);
        // Record why, and release the claim so tomorrow's run retries this
        // nudge instead of it being lost to a transient Resend failure.
        await admin
          .from('trial_pass_emails')
          .delete()
          .eq('trial_pass_id', pass.id)
          .eq('kind', 'reminder')
          .eq('sequence', due.sequence)
          .is('sent_at', null);
        failed++;
      }
    }

    // Close out windows that have run down. Two cases:
    //   1. Activated passes past their 30-day expires_at
    //   2. Unactivated passes past their 60-day signup_expires_at
    // Loaded as two queries because a single OR() across nullable columns is
    // fragile in postgrest, and both scans are indexed.
    const [expiredActivatedRes, expiredUnactivatedRes] = await Promise.all([
      admin
        .from('trial_passes')
        .select('id, status, expires_at, extended_until, activated_at, signup_expires_at')
        .in('status', ['active', 'extended'])
        .not('activated_at', 'is', null)
        .lt('expires_at', now.toISOString()),
      admin
        .from('trial_passes')
        .select('id, status, expires_at, extended_until, activated_at, signup_expires_at')
        .in('status', ['active', 'extended'])
        .is('activated_at', null)
        .lt('signup_expires_at', now.toISOString()),
    ]);

    if (expiredActivatedRes.error) {
      throw new Error(`Failed to load expired activated passes: ${expiredActivatedRes.error.message}`);
    }
    if (expiredUnactivatedRes.error) {
      throw new Error(`Failed to load expired unactivated passes: ${expiredUnactivatedRes.error.message}`);
    }

    const openPasses = [
      ...(expiredActivatedRes.data || []),
      ...(expiredUnactivatedRes.data || []),
    ];
    const toExpire = openPasses.filter((pass) => needsExpiryFlip(pass, now)).map((p) => p.id);
    let expired = 0;
    if (toExpire.length > 0) {
      const { error: expireError } = await admin
        .from('trial_passes')
        .update({ status: 'expired' })
        .in('id', toExpire)
        // Re-checked in the WHERE clause so a pass that converted between the
        // read and this write is not walked backwards into 'expired'.
        .in('status', ['active', 'extended']);
      if (expireError) {
        console.error('[cron.trial-pass-reminders.expire]', expireError);
      } else {
        expired = toExpire.length;
      }
    }

    return NextResponse.json({ ok: true, considered: candidates?.length || 0, sent, skipped, failed, expired });
  } catch (err) {
    console.error('[cron.trial-pass-reminders]', err);
    return NextResponse.json({ error: `Server error: ${err?.message || 'unknown'}` }, { status: 500 });
  }
}
