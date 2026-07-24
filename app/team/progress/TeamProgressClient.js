'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { classifyTask, toDateString } from '@/lib/progress';
import { StatusBadge, PriorityBadge, DeptChip, AttentionFlags, formatDate } from '@/app/bananas/progress/ui';
import TaskDrawer from '@/app/bananas/progress/TaskDrawer';
import ThemeToggle from '@/app/components/ThemeToggle';

const THEME_KEY = 'sdg-team-progress-theme';

// Local, page-scoped light/dark palette — mirrors the pattern used by the
// admin Team Calendar (app/bananas/calendar/CalendarClient.js). Dark values
// are the original hardcoded colors this page always used; light values are
// new. No global theme system involved.
const THEMES = {
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
    pageBg: '#f2efe8',
    cardBg: '#ffffff',
    emptyBorder: 'rgba(0,0,0,0.08)',
    cardBorder: 'rgba(0,0,0,0.08)',
    attentionBorder: 'rgba(220,38,38,0.35)',
    overdue: '#b91c1c',
  },
};

// Team-facing progress list. Read-only summary + tap to open the shared drawer,
// where the member posts updates and changes status among permitted states.
// `canManage`/`canDelete` are intentionally NOT passed, so the drawer shows the
// contributor surface only — the API enforces the same limits regardless.
export default function TeamProgressClient({ initialTasks, assignees, currentUserName, todayIso }) {
  const router = useRouter();
  const todayStr = toDateString(todayIso);
  const [drawerTask, setDrawerTask] = useState(null);

  const [theme, setTheme] = useState('dark');
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(THEME_KEY);
      if (saved === 'light' || saved === 'dark') setTheme(saved);
    } catch {
      // localStorage unavailable — fall back to default dark theme silently.
    }
  }, []);
  const toggleTheme = () => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      try { window.localStorage.setItem(THEME_KEY, next); } catch {}
      return next;
    });
  };
  const t = THEMES[theme];

  const { attention, rest } = useMemo(() => {
    const a = [];
    const r = [];
    for (const t of initialTasks) {
      (classifyTask(t, todayStr).needsAttention ? a : r).push(t);
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
            My Progress
          </h1>
          <p className="text-[13px] mt-1" style={{ color: t.muted }}>
            {currentUserName} · tap a task to post an update
          </p>
        </div>
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
      </div>

      {initialTasks.length === 0 ? (
        <div className="rounded-[14px] p-12 text-center" style={{ background: t.cardBg, border: `1px solid ${t.emptyBorder}` }}>
          <p className="text-[15px]" style={{ color: t.muted }}>Nothing assigned to you right now.</p>
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
