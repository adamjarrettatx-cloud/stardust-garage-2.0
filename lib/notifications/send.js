// notify() \u2014 the single entry point every feature calls to fire a
// notification. Never throws: a notification failure must never break the
// underlying flow (ticket purchase, contract signing, etc). Failures are
// logged, the caller keeps going.
//
// Usage:
//
//   import { notify } from '@/lib/notifications/send';
//   await notify(admin, {
//     userId,
//     type: 'ticket_ready',
//     title: 'Your ticket is ready',
//     body: 'Friday, Oct 31 \u00b7 The Halloween Warehouse',
//     data: { event_id, ticket_id, url: '/wallet' },
//     email: {
//       // optional \u2014 only used if the type has email enabled AND user
//       // hasn't opted out
//       send: () => sendTicketConfirmation({ ... }),
//     },
//   });
//
// The function:
//   1. Loads the (user_id, type) preference row if it exists.
//   2. Writes the in-app notification row (always \u2014 the feed is the
//      source of truth).
//   3. Fires the email callback if the user has email on for that type.
//   4. Fans out to Expo Push through the send-push Edge Function.

import { getType, effectiveChannels } from './types.js';
import { createAdminClient } from '../supabase/admin.js';

// This is the mobile push contract. Keep the values stable and snake_case:
// mobile routes notifications from data.type, not from the feed type.
const PUSH_TYPE_BY_NOTIFICATION_TYPE = {
  ticket_ready: 'ticket_purchased',
  ticket_event_updated: 'ticket_purchased',
  ticket_event_cancelled: 'ticket_purchased',
  ticket_refund_issued: 'ticket_purchased',
  ticket_event_tomorrow: 'ticket_purchased',
  ticket_event_soon: 'ticket_purchased',
  door_checkin: 'door_checkin',
  trial_activated: 'trial_approved',
  trial_ending_soon: 'trial_approved',
  trial_ending_tomorrow: 'trial_approved',
  trial_application_received: 'trial_approved',
  trial_membership_approved: 'trial_approved',
  member_welcome: 'membership_update',
  member_renewal_upcoming: 'membership_update',
  member_payment_failed: 'membership_update',
  member_expiring: 'membership_update',
  event_published: 'admin_broadcast',
  event_member_presale_open: 'admin_broadcast',
  marketing_broadcast: 'admin_broadcast',
  contract_signed: 'admin_broadcast',
  staff_door_scan_denied: 'admin_broadcast',
  staff_capacity_threshold: 'admin_broadcast',
  admin_member_application: 'admin_broadcast',
  admin_refund_requested: 'admin_broadcast',
  admin_ticket_sold: 'admin_broadcast',
};

function pushTypeForNotification(type) {
  return PUSH_TYPE_BY_NOTIFICATION_TYPE[type] || 'admin_broadcast';
}

// Calls the versioned Edge Function with a service-role client. This remains
// best-effort so a push-provider failure never fails checkout, a door scan, or
// another durable product flow.
export async function sendPushToUser({ userId, title, body, data = {}, type }) {
  if (!userId || !title || !body || !type) {
    return { ok: false, error: 'missing_fields' };
  }

  try {
    const supabaseAdmin = createAdminClient();
    const { data: result, error } = await supabaseAdmin.functions.invoke('send-push', {
      body: { user_id: userId, title, body, data, type },
    });
    if (error) {
      console.error('[notifications.push]', error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true, result };
  } catch (err) {
    const message = err?.message || String(err);
    console.error('[notifications.push]', message);
    return { ok: false, error: message };
  }
}

export async function notify(admin, opts) {
  const {
    userId,
    type,
    title,
    body = null,
    data = {},
    email = null,
    // When true, skip the in-app write (used by cron jobs that only want
    // to send email without adding another feed row for a scheduled ping).
    skipInApp = false,
    // Canonical mobile type for a notification that has a more granular
    // in-app feed type (for example, event_published -> admin_broadcast).
    pushType = null,
  } = opts || {};

  if (!admin) {
    console.error('[notify] missing admin client');
    return { ok: false, error: 'missing_admin' };
  }
  if (!userId || !type || !title) {
    console.error('[notify] missing required fields', { userId: !!userId, type, title });
    return { ok: false, error: 'missing_fields' };
  }

  const typeDef = getType(type);
  if (!typeDef) {
    console.error('[notify] unknown notification type', type);
    return { ok: false, error: 'unknown_type' };
  }

  // Load user's preference row for this type. Absence = use type defaults.
  let prefRow = null;
  try {
    const { data: pref } = await admin
      .from('notification_preferences')
      .select('user_id, type, in_app, push, email')
      .eq('user_id', userId)
      .eq('type', type)
      .maybeSingle();
    prefRow = pref || null;
  } catch (err) {
    // If the pref lookup fails, fall back to defaults. Not fatal.
    console.error('[notify] pref lookup failed', err?.message || err);
  }

  const channels = effectiveChannels(type, prefRow);
  const channelsSent = [];

  // ---------------- IN-APP ----------------
  if (channels.in_app && !skipInApp) {
    try {
      const { error } = await admin.from('notifications').insert({
        user_id: userId,
        type,
        title,
        body,
        data,
        channels_sent: [], // updated below after all channels settle
      });
      if (error) {
        console.error('[notify.in_app]', error.message);
      } else {
        channelsSent.push('in_app');
      }
    } catch (err) {
      console.error('[notify.in_app] threw', err?.message || err);
    }
  }

  // ---------------- EMAIL ----------------
  if (channels.email && email && typeof email.send === 'function') {
    try {
      await email.send();
      channelsSent.push('email');
    } catch (err) {
      // Email failures are logged but do NOT block. The in-app row already
      // captured the notification \u2014 the user will see it in the feed
      // even if the email provider is down.
      console.error('[notify.email]', type, err?.message || err);
    }
  }

  // ---------------- PUSH ----------------
  if (channels.push) {
    const push = await sendPushToUser({
      userId,
      title,
      body: body || title,
      data,
      type: pushType || pushTypeForNotification(type),
    });
    if (push.ok) channelsSent.push('push');
  }

  // Best-effort update of channels_sent on the row we just wrote. Silent on
  // failure \u2014 the notification was delivered even if the audit column is
  // wrong.
  if (channelsSent.length > 0 && !skipInApp) {
    try {
      await admin
        .from('notifications')
        .update({ channels_sent: channelsSent })
        .eq('user_id', userId)
        .eq('type', type)
        .order('created_at', { ascending: false })
        .limit(1);
    } catch {
      // ignore \u2014 audit column only
    }
  }

  return { ok: true, channels_sent: channelsSent };
}

// Convenience: fan a single notification out to many users. Serialised so
// one bad row doesn't blow up the whole batch. Returns per-user results.
export async function notifyMany(admin, userIds, opts) {
  const results = [];
  for (const userId of userIds) {
    const r = await notify(admin, { ...opts, userId });
    results.push({ userId, ...r });
  }
  return results;
}
