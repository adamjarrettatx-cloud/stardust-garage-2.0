import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import ProgressClient from './ProgressClient';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

const OWNER_EMAIL = 'adam@sdgatx.com';

// Admin/Owner Progress Tracker. Access is gated server-side by adminPageGate()
// (admin per team_members + MFA-ready). The nav link is NOT the security
// boundary — the page gate and RLS are. Admins act as the general manager
// (create/assign/edit/archive/complete); the owner additionally sees the
// hard-delete control (enforced again server-side in the API).
export default async function ProgressPage() {
  const { user, redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const isOwner = user?.email === OWNER_EMAIL;
  const supabase = await createClient();

  // Admin RLS returns every task. Team profiles power the assignee dropdown and
  // let us show human names instead of ids.
  const [{ data: tasks }, { data: members }, { data: updateStamps }] = await Promise.all([
    supabase.from('project_tasks').select('*').order('created_at', { ascending: false }),
    supabase.from('team_members').select('id, full_name, email, role').order('full_name', { ascending: true }),
    supabase.from('project_task_updates').select('task_id, created_at'),
  ]);

  // Fold the latest update timestamp onto each task so the client can compute
  // staleness without loading every thread.
  const lastByTask = {};
  for (const u of updateStamps || []) {
    if (!lastByTask[u.task_id] || u.created_at > lastByTask[u.task_id]) {
      lastByTask[u.task_id] = u.created_at;
    }
  }
  const enriched = (tasks || []).map((t) => ({ ...t, last_update_at: lastByTask[t.id] || null }));

  const assignees = (members || []).map((m) => ({
    id: m.id,
    label: m.full_name || m.email || 'Unnamed',
    role: m.role,
  }));

  return (
    <ProgressClient
      initialTasks={enriched}
      assignees={assignees}
      isOwner={isOwner}
      todayIso={new Date().toISOString()}
    />
  );
}
