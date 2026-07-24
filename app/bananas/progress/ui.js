'use client';

import {
  STATUSES,
  PRIORITIES,
  departmentLabel,
  statusLabel,
} from '@/lib/progress';

const STATUS_MAP = Object.fromEntries(STATUSES.map((s) => [s.value, s]));
const PRIORITY_MAP = Object.fromEntries(PRIORITIES.map((p) => [p.value, p]));

export function StatusBadge({ value }) {
  const s = STATUS_MAP[value] || { color: 'var(--text-3)', label: value };
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold"
      style={{ background: `${s.color}22`, color: s.color }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.color }} />
      {s.label || statusLabel(value)}
    </span>
  );
}

export function PriorityBadge({ value }) {
  const p = PRIORITY_MAP[value] || { color: 'var(--text-4)', label: value };
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold tracking-[0.08em] uppercase"
      style={{ background: `${p.color}22`, color: p.color }}
    >
      {p.label}
    </span>
  );
}

export function DeptChip({ slug }) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold tracking-[0.06em]"
      style={{ background: 'var(--fg-a06)', color: 'var(--text-2)' }}
    >
      {departmentLabel(slug)}
    </span>
  );
}

// Small colored pill summarising why a task needs attention. Renders nothing
// when the task is healthy.
export function AttentionFlags({ flags }) {
  const items = [];
  if (flags.overdue) items.push({ label: `Overdue ${Math.abs(flags.daysUntilDue)}d`, color: 'var(--st-ef4444)' });
  if (flags.isBlocked) items.push({ label: 'Blocked', color: 'var(--st-ef4444)' });
  if (flags.stale) items.push({ label: 'Stale update', color: 'var(--st-f59e0b)' });
  if (flags.dueSoon && !flags.overdue) items.push({ label: `Due ${flags.daysUntilDue}d`, color: 'var(--st-f59e0b)' });
  if (items.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {items.map((it) => (
        <span
          key={it.label}
          className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold"
          style={{ background: `${it.color}22`, color: it.color }}
        >
          {it.label}
        </span>
      ))}
    </span>
  );
}

export function formatDate(value) {
  if (!value) return '—';
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function formatDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}
