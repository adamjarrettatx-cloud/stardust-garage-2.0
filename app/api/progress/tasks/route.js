import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import { DEPARTMENTS, STATUSES, PRIORITIES } from '@/lib/progress';

const DEPT_SLUGS = new Set(DEPARTMENTS.map((d) => d.slug));
const STATUS_VALUES = new Set(STATUSES.map((s) => s.value));
const PRIORITY_VALUES = new Set(PRIORITIES.map((p) => p.value));

// POST /api/progress/tasks — create a task. Admin (general manager) only.
// Uses the user-context client so auth.uid() flows into the RLS check and the
// activity-log triggers record the real actor; the admin RLS insert policy
// authorises the write.
export async function POST(request) {
  const { unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) {
    return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  const title = String(body.title || '').trim();
  if (!title) return NextResponse.json({ error: 'Title is required.' }, { status: 400 });
  if (!DEPT_SLUGS.has(body.department)) {
    return NextResponse.json({ error: 'Valid department is required.' }, { status: 400 });
  }
  if (body.status && !STATUS_VALUES.has(body.status)) {
    return NextResponse.json({ error: 'Invalid status.' }, { status: 400 });
  }
  if (body.priority && !PRIORITY_VALUES.has(body.priority)) {
    return NextResponse.json({ error: 'Invalid priority.' }, { status: 400 });
  }

  const insert = {
    title,
    department: body.department,
    description: body.description ? String(body.description) : null,
    assignee_id: body.assignee_id || null,
    status: body.status || 'not_started',
    priority: body.priority || 'medium',
    due_date: body.due_date || null,
    update_cadence_days: normInt(body.update_cadence_days, 1, 365),
    next_update_due: body.next_update_due || null,
    percent_complete: normInt(body.percent_complete, 0, 100) ?? 0,
  };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('project_tasks')
    .insert(insert)
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ task: data }, { status: 201 });
}

function normInt(value, min, max) {
  if (value === null || value === undefined || value === '') return null;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
}
