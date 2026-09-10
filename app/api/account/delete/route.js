import { NextResponse } from 'next/server';
import { getRequestUser } from '@/lib/auth-helpers';
import { sendAccountDeletionConfirmation } from '@/lib/email';
import { rateLimit } from '@/lib/rate-limit';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CONFIRMATION_PHRASE = 'DELETE MY ACCOUNT';
const DELETION_RATE_LIMIT = Object.freeze({ limit: 3, windowMs: 60 * 60 * 1000 });

function deletedEmail(userId) {
  return `deleted-user-${userId}@removed`;
}

function failure(step, error) {
  console.error(`[account-delete] ${step} failed`, {
    message: error instanceof Error ? error.message : String(error),
  });
  return NextResponse.json({ error: 'Account deletion failed. Please contact hello@sdgatx.com.', step }, { status: 500 });
}

async function required(step, operation) {
  const { error } = await operation;
  if (error) throw new Error(`${step}: ${error.message || String(error)}`);
}

// Some historical deployments do not contain the legacy payments or
// event_attendance tables. Their absence is not a reason to strand an account;
// where the table exists, any failure other than its absence stops deletion.
function isMissingLegacyTable(error) {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

async function anonymizeLegacyTable({ admin, table, values, userId, memberProfileIds }) {
  let query = admin.from(table).update(values).eq('user_id', userId);
  if (memberProfileIds.length && table === 'event_attendance') {
    query = query.or(`user_id.eq.${userId},member_profile_id.in.(${memberProfileIds.join(',')})`);
  }
  const { error } = await query;
  if (error && !isMissingLegacyTable(error)) throw new Error(`${table} anonymization: ${error.message || String(error)}`);
}

async function deleteOwnedRecords({ admin, userId, memberProfileIds }) {
  const memberProfileFilter = memberProfileIds.length
    ? `user_id.eq.${userId},member_profile_id.in.(${memberProfileIds.join(',')})`
    : `user_id.eq.${userId}`;

  await required('chat message deletion', admin.from('chat_messages').delete().eq('sender_id', userId));
  await required('trial pass deletion', admin.from('trial_passes').delete().or(memberProfileFilter));
  await required('free account deletion', admin.from('free_accounts').delete().eq('user_id', userId));
  await required('push token deletion', admin.from('push_tokens').delete().eq('user_id', userId));
  await required('door session deletion', admin.from('door_sessions').delete().or(`opened_by.eq.${userId},closed_by.eq.${userId}`));

  if (memberProfileIds.length) {
    await required('member profile deletion', admin.from('member_profiles').delete().in('id', memberProfileIds));
  }
}

// POST /api/account/delete
// The endpoint deliberately performs permanent deletion. Accounting records
// remain only after their customer-facing PII and auth ownership are removed.
export async function POST(request) {
  const authorization = request.headers.get('authorization');
  if (!authorization || !/^Bearer[ \t]+\S+$/i.test(authorization.trim())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let user;
  try {
    user = await getRequestUser(request);
  } catch (error) {
    console.error('[account-delete] user verification failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'Unable to verify account.' }, { status: 403 });
  }
  if (!user?.id || !user.email) {
    return NextResponse.json({ error: 'Unable to verify account.' }, { status: 403 });
  }

  const limit = rateLimit({ key: `account-delete:${user.id}`, ...DELETION_RATE_LIMIT });
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Too many deletion attempts. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (body?.confirmation !== CONFIRMATION_PHRASE) {
    return NextResponse.json({ error: 'Confirmation phrase does not match.' }, { status: 400 });
  }
  if (body?.reason !== undefined && typeof body.reason !== 'string') {
    return NextResponse.json({ error: 'Reason must be a string.' }, { status: 400 });
  }

  const reason = body.reason?.trim().slice(0, 2000) || null;
  const initiatedFrom = request.headers.get('x-sdg-client') === 'mobile' ? 'mobile' : 'web';
  let admin;
  try {
    admin = createAdminClient();
  } catch (error) {
    return failure('admin client initialization', error);
  }
  const anonymousEmail = deletedEmail(user.id);
  let memberProfiles;
  let deletedAt;

  try {
    // Capture IDs/paths first; all later writes use the service role and are
    // idempotent enough to make a pre-auth-deletion retry safe.
    const { data, error } = await admin
      .from('member_profiles')
      .select('id, profile_photo_path')
      .eq('user_id', user.id);
    if (error) throw new Error(`member profile lookup: ${error.message || String(error)}`);
    memberProfiles = data || [];
    const memberProfileIds = memberProfiles.map((profile) => profile.id);

    const [{ data: freeAccounts, error: freeAccountError }, { data: trialPasses, error: trialPassError }] = await Promise.all([
      admin.from('free_accounts').select('profile_photo_path').eq('user_id', user.id),
      admin.from('trial_passes').select('profile_photo_path').eq('user_id', user.id),
    ]);
    if (freeAccountError) throw new Error(`free account lookup: ${freeAccountError.message || String(freeAccountError)}`);
    if (trialPassError) throw new Error(`trial pass lookup: ${trialPassError.message || String(trialPassError)}`);

    // 1. Immediately revoke every active session before mutating user data.
    const { error: signOutError } = await admin.auth.admin.signOut(user.id);
    if (signOutError) throw new Error(`session revocation: ${signOutError.message || String(signOutError)}`);

    // 2. Existing Member ID QR credentials become unusable before the profile
    // cascades away. The update is an audit action, not a soft delete.
    if (memberProfileIds.length) {
      await required(
        'member identity token revocation',
        admin
          .from('member_identity_tokens')
          .update({ revoked_at: new Date().toISOString(), revoke_reason: 'account_deleted' })
          .in('member_profile_id', memberProfileIds)
          .is('revoked_at', null),
      );
    }

    // 3. Preserve only financial/capacity records, with all direct account PII
    // and auth ownership removed. `payments` / `event_attendance` are handled
    // when their legacy tables exist (see isMissingLegacyTable above).
    const ordersFilter = memberProfileIds.length
      ? `user_id.eq.${user.id},member_profile_id.in.(${memberProfileIds.join(',')})`
      : `user_id.eq.${user.id}`;
    await required(
      'order anonymization',
      admin
        .from('orders')
        .update({ buyer_email: anonymousEmail, buyer_name: 'Deleted User', user_id: null })
        .or(ordersFilter),
    );
    await anonymizeLegacyTable({
      admin,
      table: 'payments',
      values: { buyer_email: anonymousEmail, buyer_name: 'Deleted User', user_id: null },
      userId: user.id,
      memberProfileIds,
    });
    await anonymizeLegacyTable({
      admin,
      table: 'event_attendance',
      values: { attendee_email: anonymousEmail, attendee_name: 'Deleted User', user_id: null },
      userId: user.id,
      memberProfileIds,
    });

    // 4. Preserve waiver evidence while disconnecting its auth FK. This must
    // happen before deleting auth.users; the migration permits only this
    // narrowly-scoped immutable-record anonymization.
    await required(
      'waiver acceptance anonymization',
      admin
        .from('waiver_acceptances')
        .update({ user_id: null, deleted_user_email: user.email })
        .eq('user_id', user.id),
    );

    // Holds can retain a buyer email and Stripe Checkout session identifier
    // even if the user never completed payment. Scrub both lookup paths.
    await required(
      'ticket hold anonymization by user',
      admin
        .from('ticket_holds')
        .update({
          buyer_email: anonymousEmail,
          user_id: null,
          stripe_checkout_session_id: null,
        })
        .eq('user_id', user.id),
    );
    await required(
      'ticket hold anonymization by email',
      admin
        .from('ticket_holds')
        .update({ buyer_email: anonymousEmail, stripe_checkout_session_id: null })
        .eq('buyer_email', user.email.toLowerCase()),
    );
    // Orders are accounting records, so retain their anonymized row but remove
    // the stored Checkout Session reference. There are no checkout-session
    // identifiers stored only in Stripe metadata in this application.
    await required(
      'order checkout session scrubbing',
      admin
        .from('orders')
        .update({ stripe_checkout_session_id: null })
        .or(ordersFilter),
    );

    // Remove profile photos from storage while their paths are still known.
    const profilePhotoPaths = [
      ...memberProfiles.map((profile) => profile.profile_photo_path),
      ...(freeAccounts || []).map((account) => account.profile_photo_path),
      ...(trialPasses || []).map((pass) => pass.profile_photo_path),
    ].filter(Boolean);
    if (profilePhotoPaths.length) {
      await required('profile photo deletion', admin.storage.from('profile-photos').remove(profilePhotoPaths));
    }

    // Legacy partner profile photos use the member-photos bucket and are
    // always namespaced at <auth-user-id>/. List and remove the full prefix so
    // orphaned historical uploads do not survive account deletion.
    const memberPhotoBucket = admin.storage.from('member-photos');
    let memberPhotoOffset = 0;
    let memberPhotoObjects;
    do {
      const { data, error: memberPhotoListError } = await memberPhotoBucket.list(user.id, {
        limit: 1000,
        offset: memberPhotoOffset,
      });
      if (memberPhotoListError) {
        throw new Error(`member photo listing: ${memberPhotoListError.message || String(memberPhotoListError)}`);
      }
      memberPhotoObjects = data || [];
      const memberPhotoPaths = memberPhotoObjects
        .filter((entry) => entry?.name)
        .map((entry) => `${user.id}/${entry.name}`);
      if (memberPhotoPaths.length) {
        await required('member photo deletion', memberPhotoBucket.remove(memberPhotoPaths));
      }
      memberPhotoOffset += memberPhotoObjects.length;
    } while (memberPhotoObjects.length === 1000);

    // 5. Delete personal records. Deleting member_profiles intentionally
    // cascades remaining member-scoped data such as identity-token rows.
    await deleteOwnedRecords({ admin, userId: user.id, memberProfileIds });

    // 6. The service-role-only audit row is created before the auth record is
    // removed, retaining a minimal immutable compliance record.
    const { data: auditRow, error: auditError } = await admin
      .from('account_deletions')
      .insert({
        deleted_user_id: user.id,
        deleted_email: user.email,
        reason,
        initiated_from: initiatedFrom,
      })
      .select('completed_at')
      .single();
    if (auditError) throw new Error(`account deletion audit: ${auditError.message || String(auditError)}`);
    deletedAt = auditRow.completed_at;

    // 7. Auth identity is the final irreversible database operation.
    const { error: deleteUserError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteUserError) throw new Error(`auth user deletion: ${deleteUserError.message || String(deleteUserError)}`);
  } catch (error) {
    return failure('deletion workflow', error);
  }

  // 8. Email only after successful auth deletion. A provider outage is logged
  // but cannot turn an already-completed deletion into a misleading 500.
  try {
    await sendAccountDeletionConfirmation({ email: user.email });
  } catch (error) {
    console.error('[account-delete] confirmation email failed after completed deletion', {
      userId: user.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return NextResponse.json({ ok: true, deletedAt });
}
