import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyTask,
  completedRecently,
  computeKpis,
  filterTasks,
  sortTasks,
  mapImportStatus,
  dayDiff,
  departmentLabel,
  normalizeDepartmentTags,
  persistDepartmentFilter,
  progressDepartmentStorageKey,
  readPersistedDepartment,
  statusLabel,
  parseNaturalDueDate,
  priorityFromDueDate,
  parseQuickAddTask,
  detectStatusFromText,
  startOfWeekMonday,
  endOfWeekSunday,
  completedThisWeek,
} from '../lib/progress.js';

const TODAY = '2026-07-23';

function task(overrides = {}) {
  return {
    id: overrides.id || 'id',
    title: 'A deliverable',
    department: 'marketing',
    status: 'in_progress',
    priority: 'medium',
    due_date: null,
    next_update_due: null,
    last_update_at: null,
    created_at: TODAY,
    completed_at: null,
    assignee_id: null,
    updated_at: TODAY,
    ...overrides,
  };
}

test('dayDiff counts whole days and is DST-stable', () => {
  assert.equal(dayDiff('2026-07-23', '2026-07-26'), 3);
  assert.equal(dayDiff('2026-07-26', '2026-07-23'), -3);
  assert.equal(dayDiff('2026-03-08', '2026-03-09'), 1); // US DST spring-forward
  assert.equal(dayDiff(null, '2026-07-23'), null);
});

test('classifyTask flags overdue only for non-done past-due tasks', () => {
  assert.equal(classifyTask(task({ due_date: '2026-07-20' }), TODAY).overdue, true);
  assert.equal(classifyTask(task({ due_date: '2026-07-30' }), TODAY).overdue, false);
  assert.equal(
    classifyTask(task({ due_date: '2026-07-20', status: 'done' }), TODAY).overdue,
    false,
  );
});

test('classifyTask flags dueSoon within the window but not overdue', () => {
  assert.equal(classifyTask(task({ due_date: '2026-07-25' }), TODAY).dueSoon, true);
  assert.equal(classifyTask(task({ due_date: '2026-07-23' }), TODAY).dueSoon, true);
  assert.equal(classifyTask(task({ due_date: '2026-07-28' }), TODAY).dueSoon, false);
  assert.equal(classifyTask(task({ due_date: '2026-07-20' }), TODAY).dueSoon, false);
});

test('classifyTask uses next_update_due for staleness when present', () => {
  assert.equal(classifyTask(task({ next_update_due: '2026-07-20' }), TODAY).stale, true);
  assert.equal(classifyTask(task({ next_update_due: '2026-07-25' }), TODAY).stale, false);
});

test('classifyTask falls back to last update age when no cadence set', () => {
  // last update 10 days ago > default 7-day window => stale
  assert.equal(classifyTask(task({ last_update_at: '2026-07-13' }), TODAY).stale, true);
  // last update 2 days ago => fresh
  assert.equal(classifyTask(task({ last_update_at: '2026-07-21' }), TODAY).stale, false);
});

test('classifyTask never marks a done task stale', () => {
  const c = classifyTask(task({ status: 'done', next_update_due: '2026-01-01' }), TODAY);
  assert.equal(c.stale, false);
  assert.equal(c.needsAttention, false);
});

test('needsAttention is true for blocked tasks', () => {
  assert.equal(classifyTask(task({ status: 'blocked' }), TODAY).needsAttention, true);
});

test('completedRecently respects the window and requires done status', () => {
  assert.equal(completedRecently(task({ status: 'done', completed_at: '2026-07-21' }), TODAY), true);
  assert.equal(completedRecently(task({ status: 'done', completed_at: '2026-07-10' }), TODAY), false);
  assert.equal(completedRecently(task({ status: 'in_progress', completed_at: '2026-07-21' }), TODAY), false);
});

test('computeKpis tallies each dimension independently', () => {
  const tasks = [
    task({ id: '1', due_date: '2026-07-10' }), // overdue
    task({ id: '2', status: 'blocked' }), // blocked
    task({ id: '3', next_update_due: '2026-07-01' }), // stale
    task({ id: '4', due_date: '2026-07-24' }), // due soon
    task({ id: '5', status: 'done', completed_at: '2026-07-22' }), // completed recently
  ];
  const kpis = computeKpis(tasks, TODAY);
  assert.equal(kpis.total, 5);
  assert.equal(kpis.overdue, 1);
  assert.equal(kpis.blocked, 1);
  assert.equal(kpis.stale, 1);
  assert.equal(kpis.dueSoon, 1);
  assert.equal(kpis.completedRecently, 1);
});

test('filterTasks applies department/status/priority/assignee/search', () => {
  const tasks = [
    task({ id: '1', department: 'marketing', status: 'blocked', priority: 'high', assignee_id: 'a', title: 'Launch flyer' }),
    task({ id: '2', department: 'legal', status: 'done', priority: 'low', assignee_id: 'b', title: 'Contract review' }),
  ];
  assert.deepEqual(filterTasks(tasks, { department: 'legal' }).map((t) => t.id), ['2']);
  assert.deepEqual(filterTasks(tasks, { status: 'blocked' }).map((t) => t.id), ['1']);
  assert.deepEqual(filterTasks(tasks, { priority: 'low' }).map((t) => t.id), ['2']);
  assert.deepEqual(filterTasks(tasks, { assigneeId: 'a' }).map((t) => t.id), ['1']);
  assert.deepEqual(filterTasks(tasks, {}, 'contract').map((t) => t.id), ['2']);
  assert.deepEqual(filterTasks(tasks, {}, 'FLYER').map((t) => t.id), ['1']);
});

test('filterTasks ignores a stray archived filter key', () => {
  // Archiving was removed entirely. A stale caller passing the old key must not
  // silently filter everything out.
  const tasks = [task({ id: '1' }), task({ id: '2' })];
  assert.deepEqual(filterTasks(tasks, { archived: true }).map((t) => t.id), ['1', '2']);
});

test('sortTasks by priority desc puts urgent first, nulls handled for due_date', () => {
  const tasks = [
    task({ id: 'low', priority: 'low' }),
    task({ id: 'urgent', priority: 'urgent' }),
    task({ id: 'med', priority: 'medium' }),
  ];
  assert.deepEqual(sortTasks(tasks, 'priority', 'desc').map((t) => t.id), ['urgent', 'med', 'low']);

  const withDates = [
    task({ id: 'none', due_date: null }),
    task({ id: 'early', due_date: '2026-07-01' }),
    task({ id: 'late', due_date: '2026-08-01' }),
  ];
  // asc => earliest first, null last
  assert.deepEqual(sortTasks(withDates, 'due_date', 'asc').map((t) => t.id), ['early', 'late', 'none']);
});

test('sortTasks does not mutate the input array', () => {
  const tasks = [task({ id: 'a', priority: 'low' }), task({ id: 'b', priority: 'urgent' })];
  const before = tasks.map((t) => t.id);
  sortTasks(tasks, 'priority', 'desc');
  assert.deepEqual(tasks.map((t) => t.id), before);
});

test('sortTasks by assignee sorts alphabetically with unassigned last', () => {
  const assignees = [
    { id: 'u1', label: 'Zach' },
    { id: 'u2', label: 'Adam' },
    { id: 'u3', label: 'Maya' },
  ];
  const tasks = [
    task({ id: 'z', assignee_id: 'u1' }),
    task({ id: 'unassigned', assignee_id: null }),
    task({ id: 'a', assignee_id: 'u2' }),
    task({ id: 'm', assignee_id: 'u3' }),
  ];
  assert.deepEqual(
    sortTasks(tasks, 'assignee', 'asc', { assignees }).map((t) => t.id),
    ['a', 'm', 'z', 'unassigned'],
  );
  // desc still keeps unassigned last (nulls-last).
  assert.deepEqual(
    sortTasks(tasks, 'assignee', 'desc', { assignees }).map((t) => t.id),
    ['z', 'm', 'a', 'unassigned'],
  );
});

test('sortTasks by flags ranks overdue > stale > due-soon > clean', () => {
  const today = '2026-07-23';
  const tasks = [
    // Clean: due next month, freshly updated.
    task({ id: 'clean', due_date: '2026-08-30', last_update_at: today, status: 'in_progress' }),
    // Overdue: past due date, not done.
    task({ id: 'overdue', due_date: '2026-07-01', last_update_at: today, status: 'in_progress' }),
    // Due-soon: within DUE_SOON_DAYS.
    task({ id: 'soon', due_date: '2026-07-24', last_update_at: today, status: 'in_progress' }),
    // Stale: no due date, hasn't been updated in a long time.
    task({ id: 'stale', due_date: null, last_update_at: '2026-05-01', status: 'in_progress' }),
  ];
  assert.deepEqual(
    sortTasks(tasks, 'flags', 'desc', { todayStr: today }).map((t) => t.id),
    ['overdue', 'stale', 'soon', 'clean'],
  );
});

test('mapImportStatus maps common free-form phrasings', () => {
  assert.equal(mapImportStatus('Done'), 'done');
  assert.equal(mapImportStatus('Completed and live'), 'done');
  assert.equal(mapImportStatus('BLOCKED - waiting on vendor'), 'blocked');
  assert.equal(mapImportStatus('stuck'), 'blocked');
  assert.equal(mapImportStatus('pending review'), 'waiting');
  assert.equal(mapImportStatus('In Progress'), 'in_progress');
  assert.equal(mapImportStatus('WIP'), 'in_progress');
  assert.equal(mapImportStatus('todo'), 'not_started');
  assert.equal(mapImportStatus(''), 'not_started');
  assert.equal(mapImportStatus('some random note'), 'not_started');
});

test('label helpers fall back gracefully', () => {
  assert.equal(departmentLabel('legal'), 'Legal');
  assert.equal(departmentLabel('supplies_inventory'), 'Supplies / Inventory');
  assert.equal(departmentLabel('unknown'), 'unknown');
  assert.equal(statusLabel('blocked'), 'Blocked');
  assert.equal(statusLabel(null), '—');
});

test('department filter persistence is team-member scoped with stale-value fallback', () => {
  const storage = new Map();
  const api = {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(key, value);
    },
    removeItem(key) {
      storage.delete(key);
    },
  };

  assert.equal(progressDepartmentStorageKey('member-1'), 'sdg-progress-department:member-1');
  assert.equal(readPersistedDepartment(api, 'member-1'), '');

  assert.equal(persistDepartmentFilter(api, 'member-1', 'marketing'), 'marketing');
  assert.equal(readPersistedDepartment(api, 'member-1'), 'marketing');
  assert.equal(readPersistedDepartment(api, 'member-2'), '');

  storage.set(progressDepartmentStorageKey('member-1'), 'stale-value');
  assert.equal(readPersistedDepartment(api, 'member-1'), '');

  assert.equal(persistDepartmentFilter(api, 'member-1', ''), '');
  assert.equal(readPersistedDepartment(api, 'member-1'), '');
});

// ---------------------------------------------------------------------------
// Quick-add NLP: due-date parsing + priority scale.
// TODAY ('2026-07-23') is a Thursday.
// ---------------------------------------------------------------------------
test('parseNaturalDueDate resolves weekday names to the next occurrence', () => {
  assert.equal(parseNaturalDueDate('by Friday', TODAY).dueDate, '2026-07-24');
  assert.equal(parseNaturalDueDate('due next friday', TODAY).dueDate, '2026-07-31');
  assert.equal(parseNaturalDueDate('on Thursday', TODAY).dueDate, TODAY); // today matches -> today
});

test('parseNaturalDueDate resolves relative phrases', () => {
  assert.equal(parseNaturalDueDate('in 3 days', TODAY).dueDate, '2026-07-26');
  assert.equal(parseNaturalDueDate('in 2 weeks', TODAY).dueDate, '2026-08-06');
  assert.equal(parseNaturalDueDate('tomorrow', TODAY).dueDate, '2026-07-24');
  assert.equal(parseNaturalDueDate('by end of week', TODAY).dueDate, '2026-07-24');
  assert.equal(parseNaturalDueDate('by next week', TODAY).dueDate, '2026-07-30');
});

test('parseNaturalDueDate resolves explicit dates', () => {
  assert.equal(parseNaturalDueDate('due 8/1', TODAY).dueDate, '2026-08-01');
  assert.equal(parseNaturalDueDate('by August 15', TODAY).dueDate, '2026-08-15');
  assert.equal(parseNaturalDueDate('by 8/15/2027', TODAY).dueDate, '2027-08-15');
});

test('parseNaturalDueDate returns no match when there is no date phrase', () => {
  const r = parseNaturalDueDate('We need more staff on the floor', TODAY);
  assert.equal(r.dueDate, null);
  assert.equal(r.matchIndex, -1);
});

test('priorityFromDueDate applies the day-based urgency scale', () => {
  assert.equal(priorityFromDueDate('2026-07-25', TODAY), 'urgent'); // 2 days
  assert.equal(priorityFromDueDate('2026-07-30', TODAY), 'urgent'); // 7 days (boundary)
  assert.equal(priorityFromDueDate('2026-08-02', TODAY), 'high'); // 10 days
  assert.equal(priorityFromDueDate('2026-08-06', TODAY), 'high'); // 14 days (boundary)
  assert.equal(priorityFromDueDate('2026-08-07', TODAY), 'medium'); // 15 days
  assert.equal(priorityFromDueDate('2026-08-13', TODAY), 'medium'); // 21 days (boundary)
  assert.equal(priorityFromDueDate('2026-08-14', TODAY), 'low'); // 22 days
  assert.equal(priorityFromDueDate('2026-07-10', TODAY), 'urgent'); // already overdue
  assert.equal(priorityFromDueDate(null, TODAY), null);
});

test('parseQuickAddTask strips the due-date phrase and computes priority', () => {
  const r = parseQuickAddTask('We need 3 members by Friday', TODAY);
  assert.equal(r.title, 'We need 3 members');
  assert.equal(r.due_date, '2026-07-24');
  assert.equal(r.priority, 'urgent');
});

test('parseQuickAddTask leaves title untouched and priority null with no date', () => {
  const r = parseQuickAddTask('Restock the bar with tonic water', TODAY);
  assert.equal(r.title, 'Restock the bar with tonic water');
  assert.equal(r.due_date, null);
  assert.equal(r.priority, null);
});

test('parseQuickAddTask picks up an @mention as assignee and strips it', () => {
  const assignees = [{ id: 'abc123', label: 'Jake Rivera' }, { id: 'xyz789', label: 'Sam Lee' }];
  const r = parseQuickAddTask('@Jake fix the POS printer by Monday', TODAY, assignees);
  assert.equal(r.assignee_id, 'abc123');
  assert.equal(r.due_date, '2026-07-27');
  assert.equal(r.title, 'fix the POS printer');
});

// ---------------------------------------------------------------------------
// Natural-language status detection.
// ---------------------------------------------------------------------------
test('detectStatusFromText recognizes plain status words', () => {
  assert.equal(detectStatusFromText('in progress'), 'in_progress');
  assert.equal(detectStatusFromText('this is being worked on'), 'in_progress');
  assert.equal(detectStatusFromText('done'), 'done');
  assert.equal(detectStatusFromText("we're blocked on legal"), 'blocked');
  assert.equal(detectStatusFromText('waiting on Sarah to approve'), 'blocked');
  assert.equal(detectStatusFromText('waiting on legal to review'), 'waiting');
  assert.equal(detectStatusFromText('not started yet'), 'not_started');
});

test('detectStatusFromText avoids false positives on negated completion', () => {
  assert.equal(detectStatusFromText('not done yet, still working through it'), 'in_progress');
  assert.equal(detectStatusFromText("can't get this done today"), null);
});

test('detectStatusFromText returns null when nothing recognizable is said', () => {
  assert.equal(detectStatusFromText('talked to the vendor about pricing'), null);
  assert.equal(detectStatusFromText(''), null);
});

// ---------------------------------------------------------------------------
// "Done this week" business-week window (Monday through Sunday).
// TODAY ('2026-07-23') is a Thursday -> week runs Jul 20 (Mon) - Jul 26 (Sun).
// ---------------------------------------------------------------------------
test('startOfWeekMonday/endOfWeekSunday bound the current business week', () => {
  assert.equal(startOfWeekMonday(TODAY), '2026-07-20');
  assert.equal(endOfWeekSunday(TODAY), '2026-07-26');
  // Monday itself is the start of its own week.
  assert.equal(startOfWeekMonday('2026-07-27'), '2026-07-27');
  assert.equal(endOfWeekSunday('2026-07-27'), '2026-08-02');
  // Sunday is the end of the week that started the prior Monday.
  assert.equal(startOfWeekMonday('2026-07-26'), '2026-07-20');
  assert.equal(endOfWeekSunday('2026-07-26'), '2026-07-26');
});

test('completedThisWeek resets every Monday and only counts done tasks in the Mon-Sun window', () => {
  assert.equal(completedThisWeek(task({ status: 'done', completed_at: '2026-07-20' }), TODAY), true); // Monday
  assert.equal(completedThisWeek(task({ status: 'done', completed_at: '2026-07-26' }), TODAY), true); // Sunday
  assert.equal(completedThisWeek(task({ status: 'done', completed_at: '2026-07-19' }), TODAY), false); // prior Sunday
  assert.equal(completedThisWeek(task({ status: 'done', completed_at: '2026-07-27' }), TODAY), false); // next Monday
  assert.equal(completedThisWeek(task({ status: 'in_progress', completed_at: '2026-07-22' }), TODAY), false);
  assert.equal(completedThisWeek(task({ status: 'done', completed_at: null }), TODAY), false);
});

test('computeKpis reports doneThisWeek using the business-week window', () => {
  const tasks = [
    task({ id: '1', status: 'done', completed_at: '2026-07-20' }), // this week (Monday)
    task({ id: '2', status: 'done', completed_at: '2026-07-19' }), // last week
    task({ id: '3', status: 'not_started' }),
  ];
  const kpis = computeKpis(tasks, TODAY);
  assert.equal(kpis.total, 3);
  assert.equal(kpis.doneThisWeek, 1);
});

test('normalizeDepartmentTags keeps valid slugs, dedupes, and reports invalid values', () => {
  assert.deepEqual(
    normalizeDepartmentTags(['marketing', 'legal']),
    { departments: ['marketing', 'legal'], invalid: [] }
  );
  assert.deepEqual(
    normalizeDepartmentTags(['marketing', 'marketing', 'website']),
    { departments: ['marketing', 'website'], invalid: [] }
  );
  // The retired slugs must now be rejected, not silently accepted.
  assert.deepEqual(
    normalizeDepartmentTags(['app', 'weekend_programming', 'weekday_programming']),
    { departments: [], invalid: ['app', 'weekend_programming', 'weekday_programming'] }
  );
  assert.deepEqual(
    normalizeDepartmentTags(['marketing', 'Marketing', 'not_a_dept', 7, null]),
    { departments: ['marketing'], invalid: ['Marketing', 'not_a_dept', 7, null] }
  );
  assert.deepEqual(normalizeDepartmentTags([]), { departments: [], invalid: [] });
  assert.deepEqual(normalizeDepartmentTags(undefined), { departments: [], invalid: [] });
  assert.deepEqual(normalizeDepartmentTags('marketing'), { departments: [], invalid: [] });
});
