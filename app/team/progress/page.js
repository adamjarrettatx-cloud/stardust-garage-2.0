import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import TeamProgressClient from './TeamProgressClient';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

// Team member Progress view. RLS on project_tasks confines the result to tasks
// assigned to or created by the caller (admins would see all, but this page is
// the team-facing surface). The team member's primary action is posting
// updates; they cannot reach admin-only tasks through this page OR via the API
// (the RPC re-checks per-row authorization server-side).
export default async function TeamProgressPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/team/login');

  const { data: teamMember } = await supabase
    .from('team_members')
    .select('id, full_name, email, role')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!teamMember) redirect('/team/login');

  // RLS returns only this member's readable tasks.
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
    <TeamProgressClient
      initialTasks={enriched}
      assignees={assignees}
      currentUserName={teamMember.full_name || teamMember.email}
      todayIso={new Date().toISOString()}
    />
  );
}
