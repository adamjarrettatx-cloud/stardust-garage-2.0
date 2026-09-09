import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/stub';
import { requireAdmin } from '@/lib/auth-helpers';
import { notifyMany } from '@/lib/notifications/send';
import { resolveAudience } from '@/lib/notifications/audience';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HOUR_MS = 60 * 60 * 1000;
const AUDIENCE_EVENT_PREFIX = 'ticket_holders_event:';

function invalidAudience(audience) {
  if (typeof audience !== 'string' || !audience) return true;
  if (['all_members', 'all_team', 'all_free_accounts'].includes(audience)) return false;
  const eventId = audience.slice(AUDIENCE_EVENT_PREFIX.length);
  return !audience.startsWith(AUDIENCE_EVENT_PREFIX) || !UUID.test(eventId);
}

async function userIdsForAudience(admin, audience) {
  if (audience === 'all_members') return resolveAudience(admin, { scope: 'members' });
  if (audience === 'all_team') return resolveAudience(admin, { scope: 'team' });

  if (audience === 'all_free_accounts') {
    const { data, error } = await admin
      .from('free_accounts')
      .select('user_id')
      .not('user_id', 'is', null);
    if (error) throw new Error(`Could not resolve free-account audience: ${error.message}`);
    return [...new Set((data || []).map((row) => row.user_id).filter(Boolean))];
  }

  const eventId = audience.slice(AUDIENCE_EVENT_PREFIX.length);
  const { data, error } = await admin
    .from('orders')
    .select('user_id')
    .eq('event_id', eventId)
    .in('status', ['paid', 'partial_refund'])
    .not('user_id', 'is', null);
  if (error) throw new Error(`Could not resolve ticket-holder audience: ${error.message}`);
  return [...new Set((data || []).map((row) => row.user_id).filter(Boolean))];
}

// POST /api/admin/notifications/broadcast
// Body: { title, body?, url?, type?, eventId?, audience }
// `audience` is deliberately a small, explicit allow-list. The client must
// generate and supply one UUID in the Idempotency-Key header for each intended
// broadcast so a retry cannot fan out a second time.
export async function POST(request) {
  const { user, unauthorized } = await requireAdmin(request);
  if (unauthorized) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!isSupabaseConfigured()) return NextResponse.json({ ok: true, sent: 0 });

  let body = {};
  try { body = await request.json(); } catch {}
  const title = String(body?.title || '').trim();
  const bodyText = body?.body ? String(body.body).trim() : '';
  const url = body?.url ? String(body.url) : null;
  const type = String(body?.type || 'event_published');
  const eventId = body?.eventId || null;
  const audience = body?.audience;
  const idempotencyKey = request.headers.get('idempotency-key')?.trim() || '';

  if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 });
  if (invalidAudience(audience)) {
    return NextResponse.json({ error: 'audience required and must be an allowed explicit audience' }, { status: 400 });
  }
  if (!UUID.test(idempotencyKey)) {
    return NextResponse.json({ error: 'Idempotency-Key header must be a UUID' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: prior, error: priorError } = await admin
    .from('notification_broadcasts')
    .select('audience, sent_count')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (priorError) {
    console.error('[admin.notifications.broadcast.idempotency-read]', priorError);
    return NextResponse.json({ error: 'Could not create broadcast record' }, { status: 500 });
  }
  if (prior) {
    return NextResponse.json({ ok: true, sent: prior.sent_count || 0, audience: prior.audience, idempotent: true });
  }

  const { data: audit, error: auditError } = await admin
    .from('notification_broadcasts')
    .insert({
      idempotency_key: idempotencyKey,
      admin_user_id: user.id,
      audience,
      subject: title,
      body: bodyText,
      sent_count: null,
    })
    .select('id, audience, sent_count')
    .single();
  if (auditError) {
    // A concurrent retry can lose the insert race. Return its durable result
    // rather than sending again.
    if (auditError.code === '23505') {
      const { data: duplicate } = await admin
        .from('notification_broadcasts')
        .select('audience, sent_count')
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
      if (duplicate) {
        return NextResponse.json({ ok: true, sent: duplicate.sent_count || 0, audience: duplicate.audience, idempotent: true });
      }
    }
    console.error('[admin.notifications.broadcast.audit]', auditError);
    return NextResponse.json({ error: 'Could not create broadcast record' }, { status: 500 });
  }

  // The audit insert deliberately precedes the limits so blocked requests are
  // visible in the same durable ledger as completed broadcasts.
  const perAdmin = rateLimit({ key: `notification_broadcast:admin:${user.id}`, limit: 5, windowMs: HOUR_MS });
  const global = rateLimit({ key: 'notification_broadcast:global', limit: 20, windowMs: HOUR_MS });
  if (!perAdmin.ok || !global.ok) {
    const retryAfterSeconds = Math.max(perAdmin.retryAfterSeconds, global.retryAfterSeconds);
    await admin.from('notification_broadcasts').update({ sent_count: 0 }).eq('id', audit.id);
    return NextResponse.json(
      { error: 'Too many broadcasts' },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
    );
  }

  try {
    const userIds = await userIdsForAudience(admin, audience);
    const data = { url };
    if (eventId) data.event_id = eventId;
    const results = userIds.length
      ? await notifyMany(admin, userIds, { type, title, body: bodyText || null, data })
      : [];
    const sent = results.filter((result) => result.ok).length;

    const { error: countError } = await admin
      .from('notification_broadcasts')
      .update({ sent_count: sent })
      .eq('id', audit.id);
    if (countError) {
      console.error('[admin.notifications.broadcast.audit-count]', countError);
      return NextResponse.json({ error: 'Could not finalize broadcast record' }, { status: 500 });
    }

    console.log('[admin.notifications.broadcast]', { by: user.id, type, audience, recipients: userIds.length, delivered: sent });
    return NextResponse.json({ ok: true, sent, total: userIds.length, audience });
  } catch (err) {
    await admin.from('notification_broadcasts').update({ sent_count: 0 }).eq('id', audit.id);
    console.error('[admin.notifications.broadcast]', err);
    return NextResponse.json({ error: 'Could not send broadcast' }, { status: 500 });
  }
}
