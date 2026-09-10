import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEnsureNextOccurrenceDraft } from '../lib/series-generation.js';

function makeAdmin() {
  const events = [{
    id: 'template-1',
    title: 'Yoga',
    slug: 'yoga',
    event_date: '2026-09-09',
    status: 'published',
    visibility: 'public',
  }];
  const generationLogs = [];

  function eventQuery() {
    const filters = {};
    let inserted = null;
    const query = {
      select() { return query; },
      eq(field, value) { filters[field] = value; return query; },
      order() { return query; },
      maybeSingle: async () => ({
        data: events.find((row) => Object.entries(filters).every(([key, value]) => row[key] === value)) || null,
        error: null,
      }),
      insert(payload) { inserted = payload; return query; },
      single: async () => {
        if (inserted) {
          const created = { id: `event-${events.length + 1}`, ...inserted };
          events.push(created);
          return { data: created, error: null };
        }
        return {
          data: events.find((row) => Object.entries(filters).every(([key, value]) => row[key] === value)) || null,
          error: null,
        };
      },
      delete() { return { eq: async () => ({ error: null }) }; },
    };
    return query;
  }

  return {
    events,
    generationLogs,
    from(table) {
      if (table === 'events') return eventQuery();
      if (table === 'series_generation_log') {
        return { insert: async (row) => { generationLogs.push(row); return { error: null }; } };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

test('ensureNextOccurrenceDraft creates only one occurrence for a series date', async () => {
  const admin = makeAdmin();
  const ensureNextOccurrenceDraft = makeEnsureNextOccurrenceDraft({
    createShareToken: () => 'fresh-token',
    cloneOccurrenceProducts: async () => {},
  });
  const series = {
    id: 'series-1',
    is_active: true,
    recurrence_freq: 'weekly',
    ends_on: null,
    template_event_id: 'template-1',
  };
  const previousEvent = {
    id: 'previous-1',
    event_date: '2026-09-09',
    recurrence_position: 1,
  };

  const first = await ensureNextOccurrenceDraft(admin, series, { previousEvent });
  const second = await ensureNextOccurrenceDraft(admin, series, { previousEvent });

  assert.deepEqual(first, { created: true, eventId: 'event-2', eventDate: '2026-09-16' });
  assert.deepEqual(second, {
    created: false,
    eventId: 'event-2',
    eventDate: '2026-09-16',
    reason: 'already_exists',
  });
  assert.equal(admin.events.filter((event) => event.series_id === 'series-1').length, 1);
  assert.equal(admin.generationLogs.length, 1);
});
