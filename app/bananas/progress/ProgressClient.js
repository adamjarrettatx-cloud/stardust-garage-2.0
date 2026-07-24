'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  DEPARTMENTS, STATUSES, PRIORITIES,
  classifyTask, computeKpis, filterTasks, sortTasks, toDateString,
} from '@/lib/progress';
import {
  StatusBadge, PriorityBadge, DeptChip, AttentionFlags, formatDate,
} from './ui';
import TaskDrawer from './TaskDrawer';
import TaskFormModal from './TaskFormModal';
import ImportModal from './ImportModal';

const KPI_DEFS = [
  { key: 'overdue', label: 'Overdue', color: 'var(--st-ef4444)' },
  { key: 'blocked', label: 'Blocked', color: 'var(--st-ef4444)' },
  { key: 'stale', label: 'Stale update', color: 'var(--st-f59e0b)' },
  { key: 'dueSoon', label: 'Due soon', color: 'var(--st-f59e0b)' },
  { key: 'completedRecently', label: 'Completed 7d', color: 'var(--st-10b981)' },
  { key: 'total', label: 'Active total', color: 'var(--text-3)' },
];

export default function ProgressClient({ initialTasks, assignees, isOwner, todayIso }) {
  const router = useRouter();
  const todayStr = toDateString(todayIso);

  const [filters, setFilters] = useState({
    department: '', status: '', priority: '', assigneeId: '', archived: false,
  });
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('priority');
  const [sortDir, setSortDir] = useState('desc');
  const [drawerTask, setDrawerTask] = useState(null);
  const [formTask, setFormTask] = useState(undefined); // undefined = closed, null = create, object = edit
  const [showImport, setShowImport] = useState(false);

  const activeTasks = useMemo(
    () => initialTasks.filter((t) => !t.archived),
    [initialTasks],
  );
  const kpis = useMemo(() => computeKpis(activeTasks, todayStr), [activeTasks, todayStr]);

  const visible = useMemo(() => {
    const filtered = filterTasks(initialTasks, filters, search);
    return sortTasks(filtered, sortKey, sortDir);
  }, [initialTasks, filters, search, sortKey, sortDir]);

  const refresh = () => router.refresh();
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }));

  const selectStyle = {
    background: '#0a0a0a', border: '1px solid var(--fg-a1)', color: 'var(--text-1)',
    minHeight: '44px',
  };

  return (
    <main className="max-w-[1400px] mx-auto px-6 py-12">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
        <div>
          <Link href="/bananas" className="text-[12px] tracking-[0.1em] hover:underline" style={{ color: 'var(--text-3)' }}>← ADMIN</Link>
          <h1 className="text-[40px] font-extrabold -tracking-[0.02em] leading-[1.1] mt-1" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            Progress
          </h1>
          <p className="text-[13px] mt-1" style={{ color: 'var(--text-3)' }}>
            Department deliverables, updates and accountability.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button onClick={() => setShowImport(true)}
            className="px-5 py-3 rounded-full text-[12px] font-semibold tracking-[0.12em] hover:bg-white/5"
            style={{ minHeight: '44px', border: '1px solid var(--fg-a15)', color: 'var(--text-3)', cursor: 'pointer' }}>
            IMPORT CSV
          </button>
          <button onClick={() => setFormTask(null)}
            className="px-6 py-3 rounded-full text-[12px] font-semibold tracking-[0.14em] hover:-translate-y-0.5 transition-transform"
            style={{ minHeight: '44px', background: 'var(--st-ffb84d)', color: '#0a0a0a', border: 'none', cursor: 'pointer' }}>
            + NEW TASK
          </button>
        </div>
      </div>

      {/* KPI summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
        {KPI_DEFS.map((k) => (
          <div key={k.key} className="rounded-[14px] p-4" style={{ background: 'var(--surface-1)', border: '1px solid var(--fg-a05)' }}>
            <div className="text-[28px] font-extrabold leading-none" style={{ color: k.color, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              {kpis[k.key]}
            </div>
            <div className="text-[11px] font-semibold tracking-[0.1em] mt-1.5" style={{ color: 'var(--text-3)' }}>
              {k.label.toUpperCase()}
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search deliverables…"
          className="flex-1 min-w-[180px] rounded-full px-4 text-[13px]" style={selectStyle} aria-label="Search" />
        <select value={filters.department} onChange={(e) => setFilter('department', e.target.value)} className="rounded-full px-4 text-[13px]" style={selectStyle} aria-label="Department filter">
          <option value="">All departments</option>
          {DEPARTMENTS.map((d) => <option key={d.slug} value={d.slug}>{d.label}</option>)}
        </select>
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
          style={{ ...selectStyle, color: filters.archived ? 'var(--st-ffb84d)' : 'var(--text-3)', cursor: 'pointer' }}>
          {filters.archived ? 'ARCHIVED' : 'ACTIVE'}
        </button>
      </div>

      {/* List */}
      {visible.length === 0 ? (
        <div className="rounded-[14px] p-12 text-center" style={{ background: 'var(--surface-1)', border: '1px solid var(--fg-a05)' }}>
          <p className="text-[15px]" style={{ color: 'var(--text-3)' }}>No tasks match. Create one or adjust your filters.</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block rounded-[14px] overflow-hidden" style={{ border: '1px solid var(--fg-a06)' }}>
            <table className="w-full text-[13px]">
              <thead>
                <tr style={{ background: 'var(--surface-4)', color: 'var(--text-3)' }}>
                  <th className="text-left px-4 py-3 font-semibold tracking-[0.08em]">DELIVERABLE</th>
                  <th className="text-left px-4 py-3 font-semibold tracking-[0.08em]">DEPT</th>
                  <th className="text-left px-4 py-3 font-semibold tracking-[0.08em]">ASSIGNEE</th>
                  <th className="text-left px-4 py-3 font-semibold tracking-[0.08em]">STATUS</th>
                  <th className="text-left px-4 py-3 font-semibold tracking-[0.08em]">DUE</th>
                  <th className="text-left px-4 py-3 font-semibold tracking-[0.08em]">FLAGS</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((t) => {
                  const c = classifyTask(t, todayStr);
                  return (
                    <tr key={t.id} onClick={() => setDrawerTask(t)}
                      className="cursor-pointer hover:bg-white/[0.03]"
                      style={{ borderTop: '1px solid rgba(255,255,255,0.05)', background: c.needsAttention ? 'rgba(239,68,68,0.04)' : 'transparent' }}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <PriorityBadge value={t.priority} />
                          <span className="font-semibold" style={{ color: 'var(--text-1)' }}>{t.title}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3"><DeptChip slug={t.department} /></td>
                      <td className="px-4 py-3" style={{ color: 'var(--text-2)' }}>{assignees.find((a) => a.id === t.assignee_id)?.label || '—'}</td>
                      <td className="px-4 py-3"><StatusBadge value={t.status} /></td>
                      <td className="px-4 py-3" style={{ color: c.overdue ? 'var(--st-fca5a5)' : 'var(--text-2)' }}>{formatDate(t.due_date)}</td>
                      <td className="px-4 py-3"><AttentionFlags flags={c} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {visible.map((t) => {
              const c = classifyTask(t, todayStr);
              return (
                <button key={t.id} onClick={() => setDrawerTask(t)}
                  className="w-full text-left rounded-[14px] p-4"
                  style={{ background: 'var(--surface-1)', border: `1px solid ${c.needsAttention ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.06)'}`, cursor: 'pointer' }}>
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <PriorityBadge value={t.priority} />
                    <DeptChip slug={t.department} />
                  </div>
                  <div className="text-[15px] font-bold mb-2" style={{ color: 'var(--text-1)' }}>{t.title}</div>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <StatusBadge value={t.status} />
                    <span className="text-[12px]" style={{ color: c.overdue ? 'var(--st-fca5a5)' : 'var(--text-3)' }}>
                      {assignees.find((a) => a.id === t.assignee_id)?.label || 'Unassigned'} · {formatDate(t.due_date)}
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
    </main>
  );
}
