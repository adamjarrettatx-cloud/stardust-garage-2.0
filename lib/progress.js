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
// Order here is the tab order on the Tasks page, so venue-facing areas lead and
// back-office ones trail.
//
// 2026-08-29: 'weekend_programming' + 'weekday_programming' merged into a single
// 'programming', 'app' renamed to 'website', and 'operations' added. See
// supabase/migrations/20260829_progress_department_vocabulary.sql — the two DB
// CHECK constraints and this list must always move together.
export const DEPARTMENTS = [
  { slug: 'marketing', label: 'Marketing' },
  { slug: 'memberships', label: 'Memberships' },
  { slug: 'programming', label: 'Programming' },
  { slug: 'operations', label: 'Operations' },
  { slug: 'website', label: 'Website' },
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

// Validates a team member's department tags (team_members.departments). Returns
// the deduped, order-preserving list of valid slugs plus every rejected value,
// so an API route can answer 400 with the offending input. Mirrors the
// team_members_departments_check constraint.
export function normalizeDepartmentTags(value) {
  if (!Array.isArray(value)) return { departments: [], invalid: [] };
  const departments = [];
  const invalid = [];
  for (const raw of value) {
    if (typeof raw !== 'string' || !VALID_DEPARTMENTS.has(raw)) {
      invalid.push(raw);
    } else if (!departments.includes(raw)) {
      departments.push(raw);
    }
  }
  return { departments, invalid };
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
    if (q) {
      const hay = `${task.title || ''} ${task.description || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Sorting. Stable, non-mutating. Supported keys: 'priority', 'due_date',
// 'status', 'updated_at', 'title', 'department', 'assignee', 'flags'.
// `dir` is 'asc' | 'desc'.
//
// 'assignee' sorts alphabetically by the resolved assignee label (the same
// string the table renders); pass an `assignees` array in `opts` so the
// helper can look up labels from `task.assignee_id`. Unassigned rows sort
// last regardless of direction.
//
// 'flags' sorts by attention severity (overdue > stale > due-soon > none),
// which mirrors the FLAGS column. Pass `todayStr` in `opts` for accurate
// overdue/stale classification; when omitted, the classifier still works but
// treats 'today' as unknown.
// ---------------------------------------------------------------------------
export function sortTasks(tasks, key = 'priority', dir = 'desc', opts = {}) {
  const factor = dir === 'asc' ? 1 : -1;
  const list = [...(tasks || [])];
  const assignees = Array.isArray(opts.assignees) ? opts.assignees : [];
  const todayStr = opts.todayStr || null;

  const assigneeLabel = (task) => {
    const match = assignees.find((a) => a.id === task.assignee_id);
    return match ? String(match.label || '').toLowerCase() : '';
  };

  const flagRank = (task) => {
    // Higher rank = more urgent. Matches the visual severity of the FLAGS
    // column: overdue (red) > stale (amber) > due-soon (amber) > clean.
    const c = classifyTask(task, todayStr);
    if (c.overdue) return 3;
    if (c.stale) return 2;
    if (c.dueSoon) return 1;
    return 0;
  };

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
      case 'assignee': {
        // Unassigned rows sort last regardless of direction, matching the
        // 'nulls last' behaviour used for due_date.
        const al = assigneeLabel(a);
        const bl = assigneeLabel(b);
        if (!al && !bl) return 0;
        if (!al) return 1;
        if (!bl) return -1;
        av = al;
        bv = bl;
        break;
      }
      case 'flags':
        av = flagRank(a);
        bv = flagRank(b);
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

// ---------------------------------------------------------------------------
// Natural-language quick add. Lets an admin type something like
// "We need 3 members by Friday" into a single box instead of filling out the
// full form. We pull a due date out of the free text (explicit dates, month
// names, weekday names, or relative phrases like "in 3 days"/"end of week"),
// strip that phrase back out of the title, and derive priority from how far
// out the date is using a fixed day-based scale. Everything here is a pure
// string->data function so it's unit-testable and safe to reuse for a live
// preview in the UI as the admin types.
// ---------------------------------------------------------------------------
const WEEKDAY_ABBR_TO_INDEX = {
  sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, weds: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6,
};
const MONTH_NAME_TO_INDEX = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

function addDaysToDateString(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function weekdayIndexOf(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

function endOfMonthDateString(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return last.toISOString().slice(0, 10);
}

// Ordered most-specific-first so an explicit date always wins over a vaguer
// relative phrase that happens to also appear in the same sentence.
function naturalDueDatePatterns(todayStr) {
  const todayDow = weekdayIndexOf(todayStr);
  const currentYear = new Date(`${todayStr}T00:00:00Z`).getUTCFullYear();
  return [
    {
      // 8/15 or 8/15/2026
      re: /\b(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])(?:\/(\d{2,4}))?\b/,
      resolve: (m) => {
        const mo = Number(m[1]) - 1;
        const day = Number(m[2]);
        let year = m[3] ? Number(m[3]) : currentYear;
        if (year < 100) year += 2000;
        let iso = new Date(Date.UTC(year, mo, day)).toISOString().slice(0, 10);
        if (!m[3] && dayDiff(todayStr, iso) < -30) {
          iso = new Date(Date.UTC(year + 1, mo, day)).toISOString().slice(0, 10);
        }
        return iso;
      },
    },
    {
      // August 15, Aug 15th
      re: /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/i,
      resolve: (m) => {
        const mo = MONTH_NAME_TO_INDEX[m[1].toLowerCase()];
        const day = Number(m[2]);
        let iso = new Date(Date.UTC(currentYear, mo, day)).toISOString().slice(0, 10);
        if (dayDiff(todayStr, iso) < -30) {
          iso = new Date(Date.UTC(currentYear + 1, mo, day)).toISOString().slice(0, 10);
        }
        return iso;
      },
    },
    { re: /\b(end of (?:the |this )?month|eom)\b/i, resolve: () => endOfMonthDateString(todayStr) },
    {
      re: /\b(end of (?:the |this )?week|eow)\b/i,
      resolve: () => addDaysToDateString(todayStr, (5 - todayDow + 7) % 7),
    },
    { re: /\bnext week\b/i, resolve: () => addDaysToDateString(todayStr, 7) },
    {
      re: /\bin\s+(\d+)\s+(day|days|week|weeks)\b/i,
      resolve: (m) => addDaysToDateString(todayStr, m[2].toLowerCase().startsWith('week') ? Number(m[1]) * 7 : Number(m[1])),
    },
    { re: /\btomorrow\b/i, resolve: () => addDaysToDateString(todayStr, 1) },
    { re: /\b(tonight|today|eod|end of day)\b/i, resolve: () => todayStr },
    {
      // "Friday", "next Friday", "fri" — always resolves to a day >= today.
      re: /\b(next\s+)?(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:urday)?)\b/i,
      resolve: (m) => {
        const isNext = Boolean(m[1]);
        const idx = WEEKDAY_ABBR_TO_INDEX[m[2].toLowerCase().slice(0, 3)];
        let delta = (idx - todayDow + 7) % 7;
        if (isNext) delta = delta === 0 ? 7 : delta + 7;
        return addDaysToDateString(todayStr, delta);
      },
    },
  ];
}

// Scans free text for the first (most specific) due-date phrase it finds.
// Returns { dueDate, matchIndex, matchText } — matchIndex is -1 when nothing
// was found so callers can skip the strip step.
export function parseNaturalDueDate(text, todayStr) {
  const s = String(text || '');
  const today = toDateString(todayStr);
  if (!today) return { dueDate: null, matchIndex: -1, matchText: '' };
  for (const pattern of naturalDueDatePatterns(today)) {
    const m = s.match(pattern.re);
    if (m) {
      const dueDate = pattern.resolve(m);
      if (dueDate) return { dueDate, matchIndex: m.index, matchText: m[0] };
    }
  }
  return { dueDate: null, matchIndex: -1, matchText: '' };
}

// Removes the matched due-date phrase (and a leading trigger word like
// "by"/"due"/"on"/"before"/"until"/"for", if present right before it) from the
// raw text so what's left reads like a clean task title.
export function stripDueDatePhrase(text, matchIndex, matchText) {
  if (matchIndex < 0) return String(text || '').trim();
  const before = text.slice(0, matchIndex);
  const after = text.slice(matchIndex + matchText.length);
  const trimmedBefore = before.replace(/\b(by|due|on|before|until|for)\s*$/i, '').replace(/[\s,.:;-]+$/, '');
  const trimmedAfter = after.replace(/^[\s,.:;-]+/, '');
  return `${trimmedBefore} ${trimmedAfter}`.replace(/\s+/g, ' ').trim();
}

// The user-specified urgency scale, applied to however many days out the due
// date is (negative = already overdue, which is always urgent).
export function priorityFromDueDate(dueDate, todayStr) {
  if (!dueDate) return null;
  const days = dayDiff(todayStr, dueDate);
  if (days === null) return null;
  if (days <= 7) return 'urgent';
  if (days <= 14) return 'high';
  if (days <= 21) return 'medium';
  return 'low';
}

// Full quick-add parse: pulls the due date (if any) out of free text, derives
// priority from it, and returns the cleaned-up title to save. `assignees` is
// an optional [{ id, label }] list — an "@Name" mention in the text assigns
// the task to the first matching person and gets stripped from the title too.
export function parseQuickAddTask(rawText, todayStr, assignees = []) {
  let working = String(rawText || '').trim();

  let assigneeId = null;
  const mention = working.match(/@([a-z][a-z'-]*)/i);
  if (mention) {
    const name = mention[1].toLowerCase();
    const match = (assignees || []).find((a) => String(a.label || '').toLowerCase().split(/\s+/).some((part) => part.startsWith(name)));
    if (match) {
      assigneeId = match.id;
      working = `${working.slice(0, mention.index)} ${working.slice(mention.index + mention[0].length)}`.replace(/\s+/g, ' ').trim();
    }
  }

  const { dueDate, matchIndex, matchText } = parseNaturalDueDate(working, todayStr);
  const title = dueDate ? stripDueDatePhrase(working, matchIndex, matchText) : working;
  const priority = dueDate ? priorityFromDueDate(dueDate, todayStr) : null;

  return {
    title: title || working,
    due_date: dueDate,
    priority,
    assignee_id: assigneeId,
  };
}

// ---------------------------------------------------------------------------
// Natural-language status updates. Lets a team member type "this is being
// worked on" or "in progress" in the update box and have the status change
// happen automatically instead of also picking it from a dropdown. Order
// matters: checked most-specific/most-blocking first. `done` has a negation
// guard so "not done yet" / "can't get this done" never falsely closes a task
// — those return null (no change) rather than guessing wrong.
// ---------------------------------------------------------------------------
const STATUS_INTENT_PATTERNS = [
  {
    status: 'blocked',
    re: /\b(blocked|blocking me|stuck|stalled|can'?t (?:move|proceed|continue)|waiting on \w+ to (?:unblock|respond|approve))\b/i,
  },
  {
    status: 'waiting',
    re: /\b(waiting on|waiting for|pending (?:approval|review|response)|on hold|paused|awaiting)\b/i,
  },
  {
    status: 'done',
    re: /\b(done|complete(?:d)?|finished|wrapped up|all set|shipped|launched|closed out)\b/i,
    negativeRe: /\b(not|isn'?t|aren'?t|wasn'?t|weren'?t|haven'?t|hasn'?t|won'?t|can'?t|never|not yet)\b[\s\w'-]{0,25}\b(done|complete(?:d)?|finished|wrapped up|shipped|launched)\b/i,
  },
  {
    status: 'in_progress',
    re: /\b(in[\s-]progress|being worked on|working (?:on|through) (?:it|this)|still working|ongoing|underway|wip|actively working|started (?:on )?(?:it|this)|making progress)\b/i,
  },
  {
    status: 'not_started',
    re: /\b(not started|haven'?t started|not begun|backlog|to-?do(?:\s+yet)?)\b/i,
  },
];

export function detectStatusFromText(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  for (const pattern of STATUS_INTENT_PATTERNS) {
    if (pattern.negativeRe && pattern.negativeRe.test(s)) continue;
    if (pattern.re.test(s)) return pattern.status;
  }
  return null;
}
