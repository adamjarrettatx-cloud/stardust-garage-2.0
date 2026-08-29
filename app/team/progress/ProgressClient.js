'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  DEPARTMENTS, STATUSES, PRIORITIES,
  classifyTask, computeKpis, filterTasks, persistDepartmentFilter,
  readPersistedDepartment, sortTasks, toDateString, parseQuickAddTask,
} from '@/lib/progress';
import {
  StatusBadge, PriorityBadge, DeptChip, AttentionFlags, formatDate,
} from '@/app/bananas/progress/ui';
import TaskDrawer from '@/app/bananas/progress/TaskDrawer';
import TaskFormModal from '@/app/bananas/progress/TaskFormModal';
import ImportModal from '@/app/bananas/progress/ImportModal';
import AuthenticatedThemeToggleControl from '@/app/components/AuthenticatedThemeToggleControl';
import { useInAdminShell } from '@/app/components/AdminShellContext';
import { useAuthenticatedTheme } from '@/app/components/AuthenticatedThemeProvider';

async function apiJson(url, options) {
  const res = await fetch(url, options);
  let json = null;
  try { json = await res.json(); } catch { /* ignore */ }
  if (res.status === 401 && json?.reason === 'mfa_required' && typeof window !== 'undefined') {
    window.location.href = '/bananas/security?mfa=required';
    throw new Error('MFA required');
  }
  if (!res.ok) throw new Error(json?.error || 'Request failed');
  return json;
}

// Unified Progress route (/team/progress). Admins and the owner get the full
// management table (filters, sort, KPIs, CSV import, hard-delete for the
// owner); team members get the simpler personal task list. These two
// surfaces render genuinely different UIs (a data table vs. a card list), so
// rather than interleave the markup line-by-line, this single component
// picks between two purpose-built inner views based on isAdmin. Either way,
// it's one file, one route, one server-verified role check (page.js) — no
// admin dataset is ever fetched and hidden client-side for team members.
export default function ProgressClient({
  isAdmin,
  initialTasks,
  assignees,
  isOwner,
  currentUserName,
  currentTeamMemberId,
  todayIso,
}) {
  if (!isAdmin) {
    return (
      <TeamProgressView
        initialTasks={initialTasks}
        assignees={assignees}
        currentUserName={currentUserName}
        todayIso={todayIso}
      />
    );
  }
  return (
    <AdminProgressView
      initialTasks={initialTasks}
      assignees={assignees}
      isOwner={isOwner}
      currentTeamMemberId={currentTeamMemberId}
      todayIso={todayIso}
    />
  );
}

// ---------------------------------------------------------------------------
// Admin / owner view — full management table.
// ---------------------------------------------------------------------------

// Local, page-scoped light/dark palette — mirrors the pattern used by the
// admin Team Calendar (app/team/calendar/CalendarClient.js). Dark values are
// the original hardcoded colors this page always used; light values are new.
// No global theme system involved. Semantic colors (KPI accents, status
// badges, priority badges) stay literal in both themes — they're tinted pills
// that already read fine on light or dark surfaces.
const ADMIN_THEMES = {
  dark: {
    text: '#f0f0f0',
    muted: '#8a8a8a',
    mutedStrong: '#c0c0c0',
    pageBg: 'transparent',
    cardBg: '#141414',
    cardBorder: 'rgba(255,255,255,0.05)',
    tableBorder: 'rgba(255,255,255,0.06)',
    rowBorder: 'rgba(255,255,255,0.05)',
    theadBg: '#161616',
    inputBg: '#0a0a0a',
    inputBorder: 'rgba(255,255,255,0.1)',
    inputText: '#e5e5e5',
    ghostBorder: 'rgba(255,255,255,0.15)',
    ghostText: '#aaa',
    attentionBorder: 'rgba(239,68,68,0.3)',
    attentionRowBg: 'rgba(239,68,68,0.04)',
    overdue: '#fca5a5',
    rowHoverClass: 'hover:bg-white/[0.03]',
  },
  light: {
    text: '#1a1a1d',
    muted: '#5c5c63',
    mutedStrong: '#4a4a52',
    pageBg: 'transparent',
    cardBg: '#ffffff',
    cardBorder: 'rgba(0,0,0,0.08)',
    tableBorder: 'rgba(0,0,0,0.1)',
    rowBorder: 'rgba(0,0,0,0.07)',
    theadBg: '#efece6',
    inputBg: '#ffffff',
    inputBorder: 'rgba(0,0,0,0.15)',
    inputText: '#1a1a1d',
    ghostBorder: 'rgba(0,0,0,0.18)',
    ghostText: '#5c5c63',
    attentionBorder: 'rgba(220,38,38,0.35)',
    attentionRowBg: 'rgba(220,38,38,0.05)',
    overdue: '#b91c1c',
    rowHoverClass: 'hover:bg-black/[0.03]',
  },
};

const KPI_DEFS = [
  { key: 'total', label: 'Total tasks', color: '#3b82f6' },
  { key: 'overdue', label: 'Overdue', color: '#ef4444' },
  { key: 'doneThisWeek', label: 'Done this week', color: '#10b981' },
];

function DepartmentTabs({ value, onChange }) {
  return (
    <div
      className="flex gap-2 overflow-x-auto pb-1 md:flex-wrap"
      role="tablist"
      aria-label="Department filter"
      data-testid="progress-department-tabs"
    >
      <DepartmentTab
        slug=""
        label="All"
        active={value === ''}
        onSelect={() => onChange('')}
      />
      {DEPARTMENTS.map((d) => (
        <DepartmentTab
          key={d.slug}
          slug={d.slug}
          label={d.label}
          active={value === d.slug}
          onSelect={() => onChange(d.slug)}
        />
      ))}
    </div>
  );
}

function DepartmentTab({ slug, label, active, onSelect }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-testid={`progress-department-tab-${slug || 'all'}`}
      onClick={onSelect}
      className="whitespace-nowrap rounded-full px-4 py-2 text-[12px] font-semibold tracking-[0.08em] transition-colors"
      style={{
        background: active ? 'var(--auth-accent)' : 'var(--auth-ghost-bg)',
        color: active ? 'var(--auth-accent-text)' : 'var(--auth-ghost-text)',
        border: `1px solid ${active ? 'var(--auth-accent)' : 'var(--auth-ghost-border)'}`,
        minHeight: '40px',
      }}
    >
      {label}
    </button>
  );
}

// Clickable column header. Toggles the table sort via `onClick(sortKey)` and
// shows an arrow indicator when this column is the active sort. Rendered
// inside <thead><tr> so it must be a real <th>, not a wrapping <button>, or
// row/column layout will break. The <th> itself is the click target and has
// button semantics for keyboard/screen-reader users.
function SortableTh({ label, sortKey, activeKey, dir, onClick, indicator }) {
  const isActive = activeKey === sortKey;
  return (
    <th
      role="button"
      tabIndex={0}
      aria-sort={isActive ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      onClick={() => onClick(sortKey)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(sortKey);
        }
      }}
      className="text-left px-4 py-3 font-semibold tracking-[0.08em] cursor-pointer select-none hover:opacity-80"
      style={{ userSelect: 'none' }}
      data-testid={`progress-sort-${sortKey}`}
    >
      {label}<span aria-hidden="true">{indicator}</span>
    </th>
  );
}

function AdminProgressView({ initialTasks, assignees, isOwner, currentTeamMemberId, todayIso }) {
  const router = useRouter();
  const todayStr = toDateString(todayIso);
  const { theme, toggleTheme } = useAuthenticatedTheme();
  const t = ADMIN_THEMES[theme];

  const [filters, setFilters] = useState({
    department: '', status: '', priority: '', assigneeId: '', archived: false,
  });
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('priority');
  const [sortDir, setSortDir] = useState('desc');
  const [drawerTask, setDrawerTask] = useState(null);
  const [formTask, setFormTask] = useState(undefined); // undefined = closed, null = create, object = edit
  const [showImport, setShowImport] = useState(false);
  const [quickAddText, setQuickAddText] = useState('');
  const [quickAdding, setQuickAdding] = useState(false);
  const [quickAddMsg, setQuickAddMsg] = useState(null); // { text, isError }

  const activeTasks = useMemo(
    () => initialTasks.filter((t) => !t.archived),
    [initialTasks],
  );
  const kpis = useMemo(() => computeKpis(activeTasks, todayStr), [activeTasks, todayStr]);

  const visible = useMemo(() => {
    const filtered = filterTasks(initialTasks, filters, search);
    return sortTasks(filtered, sortKey, sortDir, { assignees, todayStr });
  }, [initialTasks, filters, search, sortKey, sortDir, assignees, todayStr]);

  // Click a column header to sort by it. First click on an inactive column
  // uses that column's natural default direction (dates ascend, everything
  // else descends so the 'strongest' rows sit at the top). Clicking the
  // already-active column toggles direction.
  const SORT_DEFAULT_DIR = {
    title: 'asc',
    department: 'asc',
    assignee: 'asc',
    status: 'asc',
    due_date: 'asc',
    priority: 'desc',
    flags: 'desc',
    updated_at: 'desc',
  };
  const toggleSort = (key) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(SORT_DEFAULT_DIR[key] || 'asc');
    }
  };
  const sortIndicator = (key) => {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  };

  const refresh = () => router.refresh();
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }));

  // Live preview of what the quick-add box will save, so the admin sees the
  // due date/priority it picked up before hitting enter.
  const quickAddPreview = useMemo(
    () => (quickAddText.trim() ? parseQuickAddTask(quickAddText, todayStr, assignees) : null),
    [quickAddText, todayStr, assignees],
  );

  async function submitQuickAdd(e) {
    e.preventDefault();
    const raw = quickAddText.trim();
    if (!raw) return;
    setQuickAdding(true);
    setQuickAddMsg(null);
    try {
      const parsed = parseQuickAddTask(raw, todayStr, assignees);
      const payload = {
        title: parsed.title || raw,
        department: filters.department || DEPARTMENTS[0].slug,
        assignee_id: parsed.assignee_id || null,
        status: 'not_started',
        priority: parsed.priority || 'medium',
        due_date: parsed.due_date || null,
        percent_complete: 0,
      };
      await apiJson('/api/progress/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const bits = [`Added "${payload.title}"`];
      if (payload.due_date) bits.push(`due ${formatDate(payload.due_date)}`);
      bits.push(`${PRIORITIES.find((p) => p.value === payload.priority)?.label || payload.priority} priority`);
      setQuickAddMsg({ text: bits.join(' · '), isError: false });
      setQuickAddText('');
      refresh();
    } catch (err) {
      setQuickAddMsg({ text: err.message || 'Could not add that task.', isError: true });
    } finally {
      setQuickAdding(false);
    }
  }

  useEffect(() => {
    const saved = readPersistedDepartment(typeof window !== 'undefined' ? window.localStorage : null, currentTeamMemberId);
    if (saved) {
      setFilters((f) => ({ ...f, department: saved }));
    }
  }, [currentTeamMemberId]);

  const selectStyle = {
    background: t.inputBg, border: `1px solid ${t.inputBorder}`, color: t.inputText,
    minHeight: '44px',
  };

  // Only this admin view can appear inside the shell; the team-member view
  // below is never wrapped, so it keeps its own chrome unconditionally.
  const inShell = useInAdminShell();
  const Frame = inShell ? 'div' : 'main';

  return (
    <Frame
      className={
        inShell
          ? 'transition-colors duration-150'
          : 'max-w-[1400px] mx-auto px-6 py-12 transition-colors duration-150'
      }
      style={inShell ? { color: t.text } : { background: t.pageBg, color: t.text }}
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
        <div>
          {!inShell && (
            <Link href="/bananas" className="text-[12px] tracking-[0.1em] hover:underline" style={{ color: t.muted }}>← ADMIN</Link>
          )}
          <h1
            className={`font-extrabold -tracking-[0.02em] leading-[1.15] ${inShell ? 'text-[30px]' : 'text-[40px] mt-1'}`}
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: t.text }}
          >
            Tasks
          </h1>
          <p className="text-[13px] mt-1" style={{ color: t.muted }}>
            Department deliverables, updates and accountability.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <AuthenticatedThemeToggleControl theme={theme} onToggle={toggleTheme} />
          <button onClick={() => setShowImport(true)}
            className="px-5 py-3 rounded-full text-[12px] font-semibold tracking-[0.12em] hover:bg-white/5"
            style={{ minHeight: '44px', border: `1px solid ${t.ghostBorder}`, color: t.ghostText, cursor: 'pointer' }}>
            IMPORT CSV
          </button>
          <button onClick={() => setFormTask(null)}
            className="px-6 py-3 rounded-full text-[12px] font-semibold tracking-[0.14em] hover:-translate-y-0.5 transition-transform"
            style={{ minHeight: '44px', background: '#ffb84d', color: '#0a0a0a', border: 'none', cursor: 'pointer' }}>
            + NEW TASK
          </button>
        </div>
      </div>

      {/* Quick add — type it naturally, no form needed */}
      <form onSubmit={submitQuickAdd} className="rounded-[14px] p-4 mb-8" style={{ background: t.cardBg, border: `1px solid ${t.cardBorder}` }}>
        <div className="text-[11px] font-semibold tracking-[0.12em] mb-2" style={{ color: t.muted }}>QUICK ADD · JUST TYPE IT</div>
        <div className="flex flex-wrap gap-3">
          <input
            value={quickAddText}
            onChange={(e) => { setQuickAddText(e.target.value); setQuickAddMsg(null); }}
            placeholder='e.g. “We need 3 members by Friday” or “@Jake fix the printer by Monday”'
            className="flex-1 min-w-[240px] rounded-full px-4 text-[13px]"
            style={selectStyle}
          />
          <button type="submit" disabled={quickAdding || !quickAddText.trim()}
            className="px-6 py-3 rounded-full text-[12px] font-semibold tracking-[0.12em] disabled:opacity-40 hover:-translate-y-0.5 transition-transform"
            style={{ minHeight: '44px', background: '#ffb84d', color: '#0a0a0a', border: 'none', cursor: quickAdding || !quickAddText.trim() ? 'not-allowed' : 'pointer' }}>
            {quickAdding ? 'ADDING…' : 'ADD'}
          </button>
        </div>
        {quickAddPreview && (
          <div className="text-[12px] mt-2" style={{ color: t.muted }}>
            Will save as: <span style={{ color: t.mutedStrong }}>“{quickAddPreview.title || quickAddText.trim()}”</span>
            {quickAddPreview.due_date && (
              <>
                {' · due '}{formatDate(quickAddPreview.due_date)}
                {' · '}
                <span style={{ color: PRIORITIES.find((p) => p.value === quickAddPreview.priority)?.color }}>
                  {PRIORITIES.find((p) => p.value === quickAddPreview.priority)?.label}
                </span>
                {' priority'}
              </>
            )}
            {quickAddPreview.assignee_id && (
              <>{' · assigned to '}{assignees.find((a) => a.id === quickAddPreview.assignee_id)?.label}</>
            )}
            {' · '}{DEPARTMENTS.find((d) => d.slug === (filters.department || DEPARTMENTS[0].slug))?.label}
          </div>
        )}
        {quickAddMsg && (
          <div className="text-[12px] mt-2" style={{ color: quickAddMsg.isError ? '#ef4444' : '#10b981' }}>
            {quickAddMsg.text}
          </div>
        )}
      </form>

      {/* KPI summary */}
      <div className="flex flex-wrap gap-3 mb-8">
        {KPI_DEFS.map((k) => (
          <div key={k.key} className="rounded-[14px] p-4 w-[140px]" style={{ background: t.cardBg, border: `1px solid ${t.cardBorder}` }}>
            <div className="text-[28px] font-extrabold leading-none" style={{ color: k.color, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              {kpis[k.key]}
            </div>
            <div className="text-[11px] font-semibold tracking-[0.1em] mt-1.5" style={{ color: t.muted }}>
              {k.label.toUpperCase()}
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search deliverables…"
          className="flex-1 min-w-[180px] rounded-full px-4 text-[13px]" style={selectStyle} aria-label="Search" />
        <select value={filters.status} onChange={(e) => setFilter('status', e.target.value)} className="rounded-full px-4 text-[13px]" style={selectStyle} aria-label="Status filter">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select value={filters.priority} onChange={(e) => setFilter('priority', e.target.value)} className="rounded-full px-4 text-[13px]" style={selectStyle} aria-label="Priority filter">
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        <select value={filters.assigneeId} onChange={(e) => setFilter('assigneeId', e.target.value)} className="rounded-full px-4 text-[13px]" style={selectStyle} aria-label="Assignee filter">
          <option value="">All assignees</option>
          {assignees.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
        <select value={`${sortKey}:${sortDir}`} onChange={(e) => { const [k, d] = e.target.value.split(':'); setSortKey(k); setSortDir(d); }}
          className="rounded-full px-4 text-[13px]" style={selectStyle} aria-label="Sort">
          <option value="priority:desc">Priority ↓</option>
          <option value="due_date:asc">Due date ↑</option>
          <option value="updated_at:desc">Recently updated</option>
          <option value="department:asc">Department A–Z</option>
          <option value="title:asc">Title A–Z</option>
        </select>
        <button
          onClick={() => setFilter('archived', !filters.archived)}
          className="rounded-full px-4 text-[12px] font-semibold tracking-[0.08em]"
          style={{ ...selectStyle, color: filters.archived ? '#ffb84d' : t.muted, cursor: 'pointer' }}>
          {filters.archived ? 'ARCHIVED' : 'ACTIVE'}
        </button>
      </div>
      <div className="mb-6">
        <DepartmentTabs
          value={filters.department}
          onChange={(nextDepartment) => {
            setFilter('department', nextDepartment);
            if (typeof window !== 'undefined') {
              persistDepartmentFilter(window.localStorage, currentTeamMemberId, nextDepartment);
            }
          }}
        />
      </div>

      {/* List */}
      {visible.length === 0 ? (
        <div className="rounded-[14px] p-12 text-center" style={{ background: t.cardBg, border: `1px solid ${t.cardBorder}` }}>
          <p className="text-[15px]" style={{ color: t.muted }}>No tasks match. Create one or adjust your filters.</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block rounded-[14px] overflow-hidden" style={{ border: `1px solid ${t.tableBorder}` }}>
            <table className="w-full text-[13px]">
              <thead>
                <tr style={{ background: t.theadBg, color: t.muted }}>
                  <SortableTh label="DELIVERABLE" sortKey="title" activeKey={sortKey} dir={sortDir} onClick={toggleSort} indicator={sortIndicator('title')} />
                  <SortableTh label="DEPT" sortKey="department" activeKey={sortKey} dir={sortDir} onClick={toggleSort} indicator={sortIndicator('department')} />
                  <SortableTh label="ASSIGNEE" sortKey="assignee" activeKey={sortKey} dir={sortDir} onClick={toggleSort} indicator={sortIndicator('assignee')} />
                  <SortableTh label="STATUS" sortKey="status" activeKey={sortKey} dir={sortDir} onClick={toggleSort} indicator={sortIndicator('status')} />
                  <SortableTh label="DUE" sortKey="due_date" activeKey={sortKey} dir={sortDir} onClick={toggleSort} indicator={sortIndicator('due_date')} />
                  <SortableTh label="FLAGS" sortKey="flags" activeKey={sortKey} dir={sortDir} onClick={toggleSort} indicator={sortIndicator('flags')} />
                </tr>
              </thead>
              <tbody>
                {visible.map((task) => {
                  const c = classifyTask(task, todayStr);
                  return (
                    <tr key={task.id} onClick={() => setDrawerTask(task)}
                      className={`cursor-pointer ${t.rowHoverClass}`}
                      style={{ borderTop: `1px solid ${t.rowBorder}`, background: c.needsAttention ? t.attentionRowBg : 'transparent' }}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <PriorityBadge value={task.priority} />
                          <span className="font-semibold" style={{ color: t.text }}>{task.title}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3"><DeptChip slug={task.department} theme={theme} /></td>
                      <td className="px-4 py-3" style={{ color: t.mutedStrong }}>{assignees.find((a) => a.id === task.assignee_id)?.label || '—'}</td>
                      <td className="px-4 py-3"><StatusBadge value={task.status} /></td>
                      <td className="px-4 py-3" style={{ color: c.overdue ? t.overdue : t.mutedStrong }}>{formatDate(task.due_date)}</td>
                      <td className="px-4 py-3"><AttentionFlags flags={c} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {visible.map((task) => {
              const c = classifyTask(task, todayStr);
              return (
                <button key={task.id} onClick={() => setDrawerTask(task)}
                  className="w-full text-left rounded-[14px] p-4"
                  style={{ background: t.cardBg, border: `1px solid ${c.needsAttention ? t.attentionBorder : t.tableBorder}`, cursor: 'pointer' }}>
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <PriorityBadge value={task.priority} />
                    <DeptChip slug={task.department} theme={theme} />
                  </div>
                  <div className="text-[15px] font-bold mb-2" style={{ color: t.text }}>{task.title}</div>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <StatusBadge value={task.status} />
                    <span className="text-[12px]" style={{ color: c.overdue ? t.overdue : t.muted }}>
                      {assignees.find((a) => a.id === task.assignee_id)?.label || 'Unassigned'} · {formatDate(task.due_date)}
                    </span>
                  </div>
                  <div className="mt-2"><AttentionFlags flags={c} /></div>
                </button>
              );
            })}
          </div>
        </>
      )}

      {drawerTask && (
        <TaskDrawer
          task={drawerTask}
          assignees={assignees}
          theme={theme}
          canManage
          canDelete={isOwner}
          onClose={() => setDrawerTask(null)}
          onChanged={refresh}
          onEdit={(t) => { setDrawerTask(null); setFormTask(t); }}
        />
      )}
      {formTask !== undefined && (
        <TaskFormModal
          task={formTask}
          assignees={assignees}
          onClose={() => setFormTask(undefined)}
          onSaved={refresh}
        />
      )}
      {showImport && (
        <ImportModal onClose={() => setShowImport(false)} onImported={refresh} />
      )}
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Team view — personal task list (read-mostly, tap to post an update).
// ---------------------------------------------------------------------------

const TEAM_THEMES = {
  dark: {
    text: '#f0f0f0',
    muted: '#8a8a8a',
    pageBg: 'transparent',
    cardBg: '#141414',
    emptyBorder: 'rgba(255,255,255,0.05)',
    cardBorder: 'rgba(255,255,255,0.06)',
    attentionBorder: 'rgba(239,68,68,0.3)',
    overdue: '#fca5a5',
  },
  light: {
    text: '#1a1a1d',
    muted: '#5c5c63',
    pageBg: 'transparent',
    cardBg: '#ffffff',
    emptyBorder: 'rgba(0,0,0,0.08)',
    cardBorder: 'rgba(0,0,0,0.08)',
    attentionBorder: 'rgba(220,38,38,0.35)',
    overdue: '#b91c1c',
  },
};

// Read-only summary + tap to open the shared drawer, where the member posts
// updates and changes status among permitted states. `canManage`/`canDelete`
// are intentionally NOT passed, so the drawer shows the contributor surface
// only — the API enforces the same limits regardless.
function TeamProgressView({ initialTasks, assignees, currentUserName, todayIso }) {
  const router = useRouter();
  const todayStr = toDateString(todayIso);
  const [drawerTask, setDrawerTask] = useState(null);
  const { theme, toggleTheme } = useAuthenticatedTheme();
  const t = TEAM_THEMES[theme];

  const { attention, rest } = useMemo(() => {
    const a = [];
    const r = [];
    for (const task of initialTasks) {
      (classifyTask(task, todayStr).needsAttention ? a : r).push(task);
    }
    return { attention: a, rest: r };
  }, [initialTasks, todayStr]);

  const refresh = () => router.refresh();

  return (
    <main className="max-w-[900px] mx-auto px-6 py-12 transition-colors duration-150" style={{ background: t.pageBg, color: t.text }}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
        <div>
          <Link href="/team/calendar" className="text-[12px] tracking-[0.1em] hover:underline" style={{ color: t.muted }}>← TEAM</Link>
          <h1 className="text-[36px] font-extrabold -tracking-[0.02em] leading-[1.1] mt-1" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: t.text }}>
            My Tasks
          </h1>
          <p className="text-[13px] mt-1" style={{ color: t.muted }}>
            {currentUserName} · tap a task to post an update
          </p>
        </div>
        <AuthenticatedThemeToggleControl theme={theme} onToggle={toggleTheme} />
      </div>

      {initialTasks.length === 0 ? (
        <div className="rounded-[14px] p-12 text-center" style={{ background: t.cardBg, border: `1px solid ${t.emptyBorder}` }}>
          <p className="text-[15px]" style={{ color: t.muted }}>Nothing in your tasks right now.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {attention.length > 0 && (
            <Section title="NEEDS ATTENTION" tasks={attention} todayStr={todayStr} onOpen={setDrawerTask} assignees={assignees} t={t} theme={theme} />
          )}
          <Section title="ALL MY TASKS" tasks={rest} todayStr={todayStr} onOpen={setDrawerTask} assignees={assignees} t={t} theme={theme} />
        </div>
      )}

      {drawerTask && (
        <TaskDrawer
          task={drawerTask}
          assignees={assignees}
          theme={theme}
          onClose={() => setDrawerTask(null)}
          onChanged={refresh}
        />
      )}
    </main>
  );
}

function Section({ title, tasks, todayStr, onOpen, assignees, t, theme }) {
  if (tasks.length === 0) return null;
  return (
    <div>
      <div className="text-[11px] font-semibold tracking-[0.12em] mb-3" style={{ color: t.muted }}>{title}</div>
      <div className="space-y-3">
        {tasks.map((task) => {
          const c = classifyTask(task, todayStr);
          return (
            <button key={task.id} onClick={() => onOpen(task)}
              className="w-full text-left rounded-[14px] p-4"
              style={{ background: t.cardBg, border: `1px solid ${c.needsAttention ? t.attentionBorder : t.cardBorder}`, cursor: 'pointer' }}>
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <PriorityBadge value={task.priority} />
                <DeptChip slug={task.department} theme={theme} />
              </div>
              <div className="text-[16px] font-bold mb-2" style={{ color: t.text }}>{task.title}</div>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <StatusBadge value={task.status} />
                <span className="text-[12px]" style={{ color: c.overdue ? t.overdue : t.muted }}>Due {formatDate(task.due_date)}</span>
              </div>
              <div className="mt-2"><AttentionFlags flags={c} /></div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
