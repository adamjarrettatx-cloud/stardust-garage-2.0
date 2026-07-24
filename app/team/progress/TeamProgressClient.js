'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { classifyTask, toDateString } from '@/lib/progress';
import { StatusBadge, PriorityBadge, DeptChip, AttentionFlags, formatDate } from '@/app/bananas/progress/ui';
import TaskDrawer from '@/app/bananas/progress/TaskDrawer';

// Team-facing progress list. Read-only summary + tap to open the shared drawer,
// where the member posts updates and changes status among permitted states.
// `canManage`/`canDelete` are intentionally NOT passed, so the drawer shows the
// contributor surface only — the API enforces the same limits regardless.
export default function TeamProgressClient({ initialTasks, assignees, currentUserName, todayIso }) {
  const router = useRouter();
  const todayStr = toDateString(todayIso);
  const [drawerTask, setDrawerTask] = useState(null);

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
    <main className="max-w-[900px] mx-auto px-6 py-12">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
        <div>
          <Link href="/team/calendar" className="text-[12px] tracking-[0.1em] hover:underline" style={{ color: 'var(--text-3)' }}>← TEAM</Link>
          <h1 className="text-[36px] font-extrabold -tracking-[0.02em] leading-[1.1] mt-1" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            My Progress
          </h1>
          <p className="text-[13px] mt-1" style={{ color: 'var(--text-3)' }}>
            {currentUserName} · tap a task to post an update
          </p>
        </div>
      </div>

      {initialTasks.length === 0 ? (
        <div className="rounded-[14px] p-12 text-center" style={{ background: 'var(--surface-1)', border: '1px solid var(--fg-a05)' }}>
          <p className="text-[15px]" style={{ color: 'var(--text-3)' }}>Nothing assigned to you right now.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {attention.length > 0 && (
            <Section title="NEEDS ATTENTION" tasks={attention} todayStr={todayStr} onOpen={setDrawerTask} assignees={assignees} />
          )}
          <Section title="ALL MY TASKS" tasks={rest} todayStr={todayStr} onOpen={setDrawerTask} assignees={assignees} />
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

function Section({ title, tasks, todayStr, onOpen, assignees }) {
  if (tasks.length === 0) return null;
  return (
    <div>
      <div className="text-[11px] font-semibold tracking-[0.12em] mb-3" style={{ color: 'var(--text-3)' }}>{title}</div>
      <div className="space-y-3">
        {tasks.map((t) => {
          const c = classifyTask(t, todayStr);
          return (
            <button key={t.id} onClick={() => onOpen(t)}
              className="w-full text-left rounded-[14px] p-4"
              style={{ background: 'var(--surface-1)', border: `1px solid ${c.needsAttention ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.06)'}`, cursor: 'pointer' }}>
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <PriorityBadge value={t.priority} />
                <DeptChip slug={t.department} />
              </div>
              <div className="text-[16px] font-bold mb-2" style={{ color: 'var(--text-1)' }}>{t.title}</div>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <StatusBadge value={t.status} />
                <span className="text-[12px]" style={{ color: c.overdue ? 'var(--st-fca5a5)' : 'var(--text-3)' }}>Due {formatDate(t.due_date)}</span>
              </div>
              <div className="mt-2"><AttentionFlags flags={c} /></div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
