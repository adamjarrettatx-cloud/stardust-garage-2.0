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
  const s = STATUS_MAP[value] || { color: '#8a8a8a', label: value };
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
  const p = PRIORITY_MAP[value] || { color: '#6b7280', label: value };
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold tracking-[0.08em] uppercase"
      style={{ background: `${p.color}22`, color: p.color }}
    >
      {p.label}
    </span>
  );
}

// `theme` is optional and defaults to the original dark-only styling so
// existing (dark-only) callers like the admin progress board are unaffected.
// Pass theme="light" from a page that has its own light/dark toggle (e.g.
// app/team/progress/TeamProgressClient.js) to keep this chip legible on a
// light background.
export function DeptChip({ slug, theme = 'dark' }) {
  const style = theme === 'light'
    ? { background: 'rgba(0,0,0,0.06)', color: '#4a4a52' }
    : { background: 'rgba(255,255,255,0.06)', color: '#c0c0c0' };
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold tracking-[0.06em]"
      style={style}
    >
      {departmentLabel(slug)}
    </span>
  );
}

// Small colored pill summarising why a task needs attention. Renders nothing
// when the task is healthy.
export function AttentionFlags({ flags }) {
  const items = [];
  if (flags.overdue) items.push({ label: `Overdue ${Math.abs(flags.daysUntilDue)}d`, color: '#ef4444' });
  if (flags.isBlocked) items.push({ label: 'Blocked', color: '#ef4444' });
  if (flags.stale) items.push({ label: 'Stale update', color: '#f59e0b' });
  if (flags.dueSoon && !flags.overdue) items.push({ label: `Due ${flags.daysUntilDue}d`, color: '#f59e0b' });
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
