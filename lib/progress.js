// Pure data helpers for the Progress Tracker (internal project management).
//
// Everything here is a pure function over plain data shapes — no I/O, no
// secrets — so it is fully unit-testable and safe to import on the server or in
// a client component. Security lives in RLS + the API layer, NOT here; these
// helpers only classify, summarise, filter and sort rows the caller already had
// permission to read.
//
// Dates: task dates (due_date, next_update_due) are `YYYY-MM-DD` strings.
// Comparisons are done as calendar dates in a fixed reference "today" the caller
// passes in, so behaviour is deterministic and timezone-stable in tests.

// ---------------------------------------------------------------------------
// Canonical vocabularies. The DB CHECK constraints mirror these exactly; keep
// them in sync with supabase/migrations/20260723_progress_tracker.sql.
// ---------------------------------------------------------------------------
export const DEPARTMENTS = [
  { slug: 'marketing', label: 'Marketing' },
  { slug: 'memberships', label: 'Memberships' },
  { slug: 'weekend_programming', label: 'Weekend Programming' },
  { slug: 'weekday_programming', label: 'Weekday Programming' },
  { slug: 'app', label: 'App' },
  { slug: 'data', label: 'Data' },
  { slug: 'supplies_inventory', label: 'Supplies / Inventory' },
  { slug: 'products', label: 'Products' },
  { slug: 'awareness', label: 'Awareness' },
  { slug: 'management', label: 'Management' },
  { slug: 'legal', label: 'Legal' },
];

export const STATUSES = [
  { value: 'not_started', label: 'Not started', color: '#8a8a8a' },
  { value: 'in_progress', label: 'In progress', color: '#3b82f6' },
  { value: 'blocked', label: 'Blocked', color: '#ef4444' },
  { value: 'waiting', label: 'Waiting', color: '#f59e0b' },
  { value: 'done', label: 'Done', color: '#10b981' },
];

export const PRIORITIES = [
  { value: 'low', label: 'Low', color: '#6b7280', rank: 0 },
  { value: 'medium', label: 'Medium', color: '#3b82f6', rank: 1 },
  { value: 'high', label: 'High', color: '#f59e0b', rank: 2 },
  { value: 'urgent', label: 'Urgent', color: '#ef4444', rank: 3 },
];

const DEPARTMENT_LABELS = Object.fromEntries(DEPARTMENTS.map((d) => [d.slug, d.label]));
const STATUS_LABELS = Object.fromEntries(STATUSES.map((s) => [s.value, s.label]));
const PRIORITY_RANK = Object.fromEntries(PRIORITIES.map((p) => [p.value, p.rank]));
const VALID_DEPARTMENTS = new Set(DEPARTMENTS.map((d) => d.slug));

export const PROGRESS_DEPARTMENT_STORAGE_PREFIX = 'sdg-progress-department';

export function departmentLabel(slug) {
  return DEPARTMENT_LABELS[slug] || slug || '—';
}
export function statusLabel(value) {
  return STATUS_LABELS[value] || value || '—';
}

export function progressDepartmentStorageKey(teamMemberId) {
  return `${PROGRESS_DEPARTMENT_STORAGE_PREFIX}:${teamMemberId || 'anonymous'}`;
}

export function normalizeDepartmentFilter(value) {
  return VALID_DEPARTMENTS.has(value) ? value : '';
}

export function readPersistedDepartment(storage, teamMemberId) {
  if (!storage || typeof storage.getItem !== 'function') return '';
  try {
    return normalizeDepartmentFilter(storage.getItem(progressDepartmentStorageKey(teamMemberId)));
  } catch {
    return '';
  }
}

export function persistDepartmentFilter(storage, teamMemberId, department) {
  if (!storage) return;
  const key = progressDepartmentStorageKey(teamMemberId);
  const value = normalizeDepartmentFilter(department);
  try {
    if (!value) {
      storage.removeItem?.(key);
      return '';
    }
    storage.setItem?.(key, value);
    return value;
  } catch {
    return value;
  }
}

// "Due soon" window and the fallback staleness window (used only when a task
// has no explicit cadence). Days.
export const DUE_SOON_DAYS = 3;
export const DEFAULT_STALE_DAYS = 7;

// ---------------------------------------------------------------------------
// Date utilities (string-based, deterministic).
// ---------------------------------------------------------------------------
export function toDateString(value) {
  if (!value) return null;
  return String(value).slice(0, 10);
}

// Whole-day difference b - a for two `YYYY-MM-DD` strings (UTC midnight), so
// DST never shifts the count. Positive => b is after a.
export function dayDiff(aStr, bStr) {
  const a = Date.parse(`${toDateString(aStr)}T00:00:00Z`);
  const b = Date.parse(`${toDateString(bStr)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

// ---------------------------------------------------------------------------
// Classification. Turns a raw task row + reference date into the flags the UI
// needs to make stale/overdue work obvious. `todayStr` is `YYYY-MM-DD`.
// ---------------------------------------------------------------------------
export function classifyTask(task, todayStr) {
  const today = toDateString(todayStr);
  const isDone = task.status === 'done';
  const isBlocked = task.status === 'blocked';
  const isWaiting = task.status === 'waiting';

  const due = toDateString(task.due_date);
  const daysUntilDue = due ? dayDiff(today, due) : null;
  const overdue = !isDone && daysUntilDue !== null && daysUntilDue < 0;
  const dueSoon =
    !isDone && daysUntilDue !== null && daysUntilDue >= 0 && daysUntilDue <= DUE_SOON_DAYS;

  // Staleness: prefer the explicit next_update_due; otherwise fall back to time
  // since the last update (or creation) exceeding DEFAULT_STALE_DAYS. Done tasks
  // are never stale.
  const nextUpdate = toDateString(task.next_update_due);
  let stale = false;
  let daysOverdueForUpdate = null;
  if (!isDone) {
    if (nextUpdate) {
      const d = dayDiff(nextUpdate, today);
      daysOverdueForUpdate = d;
      stale = d !== null && d > 0;
    } else {
      const ref = toDateString(task.last_update_at) || toDateString(task.created_at);
      if (ref) {
        const sinceUpdate = dayDiff(ref, today);
        daysOverdueForUpdate = sinceUpdate;
        stale = sinceUpdate !== null && sinceUpdate > DEFAULT_STALE_DAYS;
      }
    }
  }

  return {
    isDone,
    isBlocked,
    isWaiting,
    overdue,
    dueSoon,
    stale,
    daysUntilDue,
    daysOverdueForUpdate,
    // Coarse attention flag driving row highlighting.
    needsAttention: overdue || isBlocked || stale,
  };
}

// Recently completed = done within the last N days (by completed_at).
export function completedRecently(task, todayStr, withinDays = DEFAULT_STALE_DAYS) {
  if (task.status !== 'done') return false;
  const completed = toDateString(task.completed_at);
  if (!completed) return false;
  const d = dayDiff(completed, toDateString(todayStr));
  return d !== null && d >= 0 && d <= withinDays;
}

// ---------------------------------------------------------------------------
// KPI summary for the owner/admin dashboard. Operates on the ACTIVE
// (non-archived) set; the caller decides what to pass in.
// ---------------------------------------------------------------------------
export function computeKpis(tasks, todayStr) {
  const kpis = {
    total: 0,
    overdue: 0,
    blocked: 0,
    stale: 0,
    dueSoon: 0,
    completedRecently: 0,
  };
  for (const task of tasks || []) {
    kpis.total += 1;
    const c = classifyTask(task, todayStr);
    if (c.overdue) kpis.overdue += 1;
    if (c.isBlocked) kpis.blocked += 1;
    if (c.stale) kpis.stale += 1;
    if (c.dueSoon) kpis.dueSoon += 1;
    if (completedRecently(task, todayStr)) kpis.completedRecently += 1;
  }
  return kpis;
}

// ---------------------------------------------------------------------------
// Filtering + search. `filters` is a plain object; any absent/empty key is
// ignored. `search` matches title/description/deliverable case-insensitively.
// ---------------------------------------------------------------------------
export function filterTasks(tasks, filters = {}, search = '') {
  const q = String(search || '').trim().toLowerCase();
  return (tasks || []).filter((task) => {
    const department = normalizeDepartmentFilter(filters.department);
    if (department && task.department !== department) return false;
    if (filters.status && task.status !== filters.status) return false;
    if (filters.priority && task.priority !== filters.priority) return false;
    if (filters.assigneeId && task.assignee_id !== filters.assigneeId) return false;
    if (filters.archived === false && task.archived) return false;
    if (filters.archived === true && !task.archived) return false;
    if (q) {
      const hay = `${task.title || ''} ${task.description || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Sorting. Stable, non-mutating. Supported keys: 'priority', 'due_date',
// 'status', 'updated_at', 'title', 'department'. `dir` is 'asc' | 'desc'.
// ---------------------------------------------------------------------------
export function sortTasks(tasks, key = 'priority', dir = 'desc') {
  const factor = dir === 'asc' ? 1 : -1;
  const list = [...(tasks || [])];
  const cmp = (a, b) => {
    let av;
    let bv;
    switch (key) {
      case 'priority':
        av = PRIORITY_RANK[a.priority] ?? -1;
        bv = PRIORITY_RANK[b.priority] ?? -1;
        break;
      case 'due_date':
        // Nulls sort last regardless of direction.
        if (!a.due_date && !b.due_date) return 0;
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        av = a.due_date;
        bv = b.due_date;
        break;
      case 'department':
        av = departmentLabel(a.department);
        bv = departmentLabel(b.department);
        break;
      case 'title':
        av = (a.title || '').toLowerCase();
        bv = (b.title || '').toLowerCase();
        break;
      case 'status':
        av = a.status || '';
        bv = b.status || '';
        break;
      case 'updated_at':
      default:
        av = a.updated_at || '';
        bv = b.updated_at || '';
        break;
    }
    if (av < bv) return -1 * factor;
    if (av > bv) return 1 * factor;
    return 0;
  };
  return list.sort(cmp);
}

// ---------------------------------------------------------------------------
// Import status mapping. The current spreadsheet uses free-form status text;
// map common phrasings to our enum. Anything unrecognised falls back to
// 'not_started' so an import never fails on an odd note — the original text is
// preserved by the caller into the description/first update.
// ---------------------------------------------------------------------------
export function mapImportStatus(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return 'not_started';
  if (/(^|\b)(done|complete|completed|finished|live|shipped|launched)\b/.test(s)) return 'done';
  if (/(block|stuck|stalled)/.test(s)) return 'blocked';
  if (/(wait|pending|hold|paused|review)/.test(s)) return 'waiting';
  if (/(in progress|in-progress|ongoing|wip|started|working|building|drafting)/.test(s)) return 'in_progress';
  if (/(not started|todo|to do|backlog|planned|not yet)/.test(s)) return 'not_started';
  return 'not_started';
}
