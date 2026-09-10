import test from 'node:test';
import assert from 'node:assert/strict';
import { makePublishEvent } from '../lib/publish-event.js';

function makeAdmin() {
  const auditInserts = [];
  const auditUpdates = [];
  const event = {
    id: 'event-2',
    title: 'Yoga',
    status: 'draft',
    series_id: 'series-1',
    tt_event_series_id: null,
    ticket_url: null,
    tt_last_published_at: '2026-09-16T19:59:00.000Z',
  };

  return {
    auditInserts,
    auditUpdates,
    from(table) {
      if (table === 'notification_broadcasts') {
        return {
          insert(row) {
            auditInserts.push(row);
            return { select: () => ({ single: async () => ({ data: { id: 'audit-1' }, error: null }) }) };
          },
          update(row) {
            auditUpdates.push(row);
            return { eq: async () => ({ error: null }) };
          },
        };
      }
      if (table === 'events') {
        return {
          select() {
            return { eq: () => ({ single: async () => ({ data: event, error: null }) }) };
          },
          update(fields) {
            return {
              eq: () => ({
                select: () => ({
                  single: async () => ({
                    data: {
                      ...event,
                      ...fields,
                      visibility: 'public',
                      slug: 'yoga-2026-09-16',
                      event_date: '2026-09-16',
                    },
                    error: null,
                  }),
                }),
              }),
            };
          },
        };
      }
      if (table === 'event_series') {
        return {
          select() {
            return { eq: () => ({ maybeSingle: async () => ({ data: { id: 'series-1', is_active: true }, error: null }) }) };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

test('cron publish bypasses admin defenses while retaining audit, fanout, and next-draft generation', async () => {
  const admin = makeAdmin();
  let rateLimitCalls = 0;
  let notificationCalls = 0;
  let nextDraftCalls = 0;
  const publishEvent = makePublishEvent({
    checkRateLimit: () => { rateLimitCalls += 1; return { ok: true, retryAfterSeconds: 0 }; },
    audienceForPublishedEvent: async () => ({ scope: 'event', eventId: 'event-2' }),
    resolveNotificationAudience: async () => ['member-1'],
    notifyRecipients: async () => { notificationCalls += 1; return [{ ok: true }]; },
    ensureNextDraft: async () => { nextDraftCalls += 1; return { created: true, eventId: 'event-3' }; },
    now: () => new Date('2026-09-16T20:00:00.000Z'),
  });

  const result = await publishEvent(admin, 'event-2', { via: 'cron' });

  assert.equal(result.status, 200);
  assert.equal(rateLimitCalls, 0);
  assert.equal(notificationCalls, 1);
  assert.equal(nextDraftCalls, 1);
  assert.equal(admin.auditInserts[0].admin_user_id, null);
  assert.equal(admin.auditInserts[0].audience, 'ticket_holders_event:event-2');
  assert.equal(
    admin.auditUpdates.at(-1).subject,
    'Event publish completed (cron auto-publish)',
  );
});
