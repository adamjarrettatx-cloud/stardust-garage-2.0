import { NextResponse } from 'next/server';
import { requireAdminMfa, requireOwner, requireTeam } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { DEPARTMENTS, STATUSES, PRIORITIES } from '@/lib/progress';

const DEPT_SLUGS = new Set(DEPARTMENTS.map((d) => d.slug));
const STATUS_VALUES = new Set(STATUSES.map((s) => s.value));
const PRIORITY_VALUES = new Set(PRIORITIES.map((p) => p.value));

// Fields an admin may edit directly. Team contributors never reach this route;
// their constrained status/percent path is POST .../updates (post_task_update).
const EDITABLE = new Set([
  'title', 'department', 'description', 'assignee_id', 'status', 'priority',
  'due_date', 'update_cadence_days', 'next_update_due', 'percent_complete',
  'archived',
]);

// GET /api/progress/tasks/:id — task detail with its update thread and activity
// log. Any team member may call; RLS confines what they can read (admins see
// all, team sees only their own assigned/created tasks). If the task isn't
// visible to the caller the task query returns nothing => 404.
export async function GET(request, { params }) {
  const { unauthorized } = await requireTeam();
  if (unauthorized) {
    return NextResponse.json({ error: 'Team access required.' }, { status: 401 });
  }
  const { id } = await params;
  const supabase = await createClient();

  const { data: task, error } = await supabase
    .from('project_tasks')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!task) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const [updatesRes, activityRes] = await Promise.all([
    supabase
      .from('project_task_updates')
      .select('*')
      .eq('task_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('project_task_activity')
      .select('*')
      .eq('task_id', id)
      .order('created_at', { ascending: false }),
  ]);

  return NextResponse.json({
    task,
    updates: updatesRes.data || [],
    activity: activityRes.data || [],
  });
}

// PATCH /api/progress/tasks/:id — edit / assign / reprioritise / set dates /
// set cadence / update status / archive / complete. Admin (GM) only. RLS admin
// update policy authorises; triggers write the activity log with the real actor.
export async function PATCH(request, { params }) {
  const { unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) {
    return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  const patch = {};
  for (const [key, value] of Object.entries(body)) {
    if (!EDITABLE.has(key)) continue;
    patch[key] = value;
  }

  if ('title' in patch) {
    const t = String(patch.title || '').trim();
    if (!t) return NextResponse.json({ error: 'Title cannot be empty.' }, { status: 400 });
    patch.title = t;
  }
  if ('department' in patch && !DEPT_SLUGS.has(patch.department)) {
    return NextResponse.json({ error: 'Invalid department.' }, { status: 400 });
  }
  if ('status' in patch && !STATUS_VALUES.has(patch.status)) {
    return NextResponse.json({ error: 'Invalid status.' }, { status: 400 });
  }
  if ('priority' in patch && !PRIORITY_VALUES.has(patch.priority)) {
    return NextResponse.json({ error: 'Invalid priority.' }, { status: 400 });
  }
  if ('percent_complete' in patch) {
    const n = Math.round(Number(patch.percent_complete));
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      return NextResponse.json({ error: 'percent_complete must be 0-100.' }, { status: 400 });
    }
    patch.percent_complete = n;
  }
  if ('update_cadence_days' in patch) {
    if (patch.update_cadence_days === null || patch.update_cadence_days === '') {
      patch.update_cadence_days = null;
    } else {
      const n = Math.round(Number(patch.update_cadence_days));
      if (!Number.isFinite(n) || n < 1 || n > 365) {
        return NextResponse.json({ error: 'update_cadence_days must be 1-365.' }, { status: 400 });
      }
      patch.update_cadence_days = n;
    }
  }
  // Normalise empty date strings to null.
  for (const k of ['due_date', 'next_update_due']) {
    if (k in patch && !patch[k]) patch[k] = null;
  }
  if ('description' in patch && !patch.description) patch.description = null;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No editable fields provided.' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('project_tasks')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data) return NextResponse.json({ error: 'Task not found.' }, { status: 404 });
  return NextResponse.json({ task: data });
}

// DELETE /api/progress/tasks/:id — hard delete. OWNER ONLY. The normal
// lifecycle end-state is archive (admins can do that via PATCH). Hard delete is
// a destructive, owner-only escape hatch, so it runs with the service-role
// client (the tables have no RLS delete policy for anyone).
export async function DELETE(request, { params }) {
  const { unauthorized } = await requireOwner();
  if (unauthorized) {
    return NextResponse.json({ error: 'Owner access required.' }, { status: 403 });
  }
  const { id } = await params;
  const admin = createAdminClient();
  const { error } = await admin.from('project_tasks').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}
