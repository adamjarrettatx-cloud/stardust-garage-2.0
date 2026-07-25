import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import ProgressClient from './ProgressClient';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

const OWNER_EMAIL = 'adam@sdgatx.com';

// Unified Progress route — reachable by both admins and team members. Role
// comes from the server-verified team_members table. Unlike Calendar, the
// two roles need genuinely different queries (admin sees every task incl.
// archived, with the full roster for the assignee dropdown; team members see
// only their RLS-scoped, non-archived tasks) so the branching happens here,
// not just in the client.
export default async function TeamProgressPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: teamMember } = await supabase
    .from('team_members')
    .select('id, full_name, email, role')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!teamMember) redirect('/login');

  const isAdmin = teamMember.role === 'admin';
  const todayIso = new Date().toISOString();

  if (isAdmin) {
    const isOwner = user.email === OWNER_EMAIL;

    // Admin RLS returns every task. Team profiles power the assignee dropdown
    // and let us show human names instead of ids.
    const [{ data: tasks }, { data: members }, { data: updateStamps }] = await Promise.all([
      supabase.from('project_tasks').select('*').order('created_at', { ascending: false }),
      supabase.from('team_members').select('id, full_name, email, role').order('full_name', { ascending: true }),
      supabase.from('project_task_updates').select('task_id, created_at'),
    ]);

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
        isAdmin
        initialTasks={enriched}
        assignees={assignees}
        isOwner={isOwner}
        currentTeamMemberId={teamMember.id}
        todayIso={todayIso}
      />
    );
  }

  // Team-facing surface. RLS on project_tasks confines the result to tasks
  // assigned to or created by the caller. The API re-checks per-row
  // authorization server-side regardless of what this page fetches.
  const { data: tasks } = await supabase
    .from('project_tasks')
    .select('*')
    .eq('archived', false)
    .order('due_date', { ascending: true, nullsFirst: false });

  const { data: updateStamps } = await supabase
    .from('project_task_updates')
    .select('task_id, created_at');

  const lastByTask = {};
  for (const u of updateStamps || []) {
    if (!lastByTask[u.task_id] || u.created_at > lastByTask[u.task_id]) {
      lastByTask[u.task_id] = u.created_at;
    }
  }
  const enriched = (tasks || []).map((t) => ({ ...t, last_update_at: lastByTask[t.id] || null }));

  // Provide the current member for assignee-name display in the drawer.
  const assignees = [{ id: teamMember.id, label: teamMember.full_name || teamMember.email, role: teamMember.role }];

  return (
    <ProgressClient
      isAdmin={false}
      initialTasks={enriched}
      assignees={assignees}
      currentUserName={teamMember.full_name || teamMember.email}
      currentTeamMemberId={teamMember.id}
      todayIso={todayIso}
    />
  );
}
