import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/stub';
import { requireAdmin } from '@/lib/auth-helpers';
import { notifyMany } from '@/lib/notifications/send';
import { resolveAudience, audienceForEvent, MEMBERSHIP_TIER_KEYS } from '@/lib/notifications/audience';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/admin/notifications/broadcast
//
// Send a notification to a defined audience. The audience is NEVER
// "everyone with a member_profile" \u2014 that would exclude trial holders,
// ticket-buying guests, partners, and team. Use an explicit scope so the
// caller (or the caller's UI) knows exactly who is being reached.
//
// Body:
//   {
//     title:  string  (required)
//     body:   string  (optional)
//     url:    string  (optional \u2014 deep link surfaced in the feed)
//     type:   string  (optional \u2014 defaults to 'event_published')
//     audience: {
//       scope: 'all' | 'members' | 'trial' | 'partners' | 'team' | 'admin' | 'event',
//       tier?:   'cowork' | 'iykyk'   // only when scope='members'
//       eventId?: string              // only when scope='event'
//     }
//     eventId: string (optional \u2014 stored on data for deep linking. If set
//                       and no audience is provided, audience defaults to
//                       audienceForEvent(eventId) so an Insider-only event
//                       auto-scopes to Insider members)
//   }
//
// Backwards-compatible: callers passing { activeOnly } instead of an
// audience get scope='members' (the pre-fix behavior) with a warning
// logged. This lets the pre-refactor admin UI keep working while we
// migrate it.
export async function POST(request) {
  const { user, unauthorized } = await requireAdmin(request);
  if (unauthorized) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!isSupabaseConfigured()) return NextResponse.json({ ok: true, sent: 0 });

  let body = {};
  try { body = await request.json(); } catch {}
  const title = String(body?.title || '').trim();
  const bodyText = body?.body ? String(body.body).trim() : null;
  const url = body?.url ? String(body.url) : null;
  const type = String(body?.type || 'event_published');
  const eventId = body?.eventId || null;

  if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 });

  const admin = createAdminClient();

  // Resolve audience.
  let audience = body?.audience || null;
  if (audience && typeof audience === 'object') {
    // Basic shape validation \u2014 don't accept unknown scopes or bad tier keys.
    const validScopes = ['all', 'members', 'trial', 'partners', 'team', 'admin', 'event'];
    if (!validScopes.includes(audience.scope)) {
      return NextResponse.json({ error: `Invalid audience.scope: ${audience.scope}` }, { status: 400 });
    }
    if (audience.tier && !MEMBERSHIP_TIER_KEYS.includes(audience.tier)) {
      return NextResponse.json({ error: `Invalid audience.tier: ${audience.tier}` }, { status: 400 });
    }
  } else if (eventId) {
    // No explicit audience but an eventId was passed \u2014 auto-scope from the
    // event row. This is the "drop an Insider-only event" path: caller
    // doesn't have to know the tier, we read it off the event.
    audience = await audienceForEvent(admin, { eventId });
  } else if (typeof body?.activeOnly === 'boolean') {
    // Legacy shape \u2014 log a deprecation and treat as members-only.
    console.warn('[admin.notifications.broadcast] legacy activeOnly used; switch to audience:{scope}');
    audience = { scope: 'members' };
  } else {
    // Safest default when nothing is specified: all accounts.
    audience = { scope: 'all' };
  }

  const userIds = await resolveAudience(admin, audience);
  if (userIds.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, total: 0, note: 'No recipients matched audience', audience });
  }

  const data = { url };
  if (eventId) data.event_id = eventId;

  const results = await notifyMany(admin, userIds, {
    type,
    title,
    body: bodyText,
    data,
  });

  const okCount = results.filter((r) => r.ok).length;
  console.log('[admin.notifications.broadcast]', {
    by: user.id,
    type,
    audience,
    recipients: userIds.length,
    delivered: okCount,
  });

  return NextResponse.json({ ok: true, sent: okCount, total: userIds.length, audience });
}
