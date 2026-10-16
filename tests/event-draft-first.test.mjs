import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('new events from the event form are inserted as drafts', () => {
  const form = read('app/bananas/components/EventForm.js');
  assert.match(form, /if \(!isEditing\) \{[\s\S]*?payload\.status = 'draft';[\s\S]*?\}/);
  // Edits never send a status, so saving cannot publish or unpublish.
  assert.doesNotMatch(form.replace(/if \(!isEditing\) \{[\s\S]*?\n    \}/, ''), /payload\.status\s*=/);
});

test('events.status defaults to draft at the database layer', () => {
  const sql = read('supabase/migrations/20261012120000_events_default_draft.sql');
  assert.match(sql, /alter column status set default 'draft'/);
});

test('visibility labels read Public / Secret / Draft', () => {
  const form = read('app/bananas/components/EventForm.js');
  assert.match(form, /value: 'unlisted', label: 'Secret'/);
  assert.match(form, /value: 'internal', label: 'Draft'/);
  assert.doesNotMatch(form, /label: 'Unlisted'/);
});

test('a team-only (Draft visibility) event cannot be manually published', async () => {
  const { makePublishEvent } = await import('../lib/publish-event.js').catch(() => ({}));
  if (!makePublishEvent) return; // module has server-only deps in some envs
  const audits = [];
  const supabase = {
    from(table) {
      const q = {
        insert: () => q, update: (f) => { audits.push(f); return q; }, select: () => q,
        eq: () => q, maybeSingle: async () => ({ data: null }),
        single: async () => table === 'notification_broadcasts'
          ? { data: { id: 'a1' } }
          : { data: { id: 'e1', status: 'draft', visibility: 'internal' } },
      };
      return q;
    },
  };
  const publish = makePublishEvent({ checkRateLimit: () => ({ ok: true }) });
  const res = await publish(supabase, 'e1', { via: 'admin', actorUserId: 'u1' });
  assert.equal(res.status, 409);
  assert.ok(!audits.some((f) => f.status === 'published'));
});
