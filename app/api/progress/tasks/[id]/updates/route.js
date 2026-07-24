import { NextResponse } from 'next/server';
import { requireTeam } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import { STATUSES } from '@/lib/progress';

const STATUS_VALUES = new Set(STATUSES.map((s) => s.value));

// POST /api/progress/tasks/:id/updates — post a progress update / comment, the
// PRIMARY team action. Any team member (team OR admin) may call. All the real
// authorisation and the constrained write (status/percent + append update) live
// in the post_task_update() SECURITY DEFINER RPC, which re-checks that the
// caller is the assignee/creator/admin for THIS task. We call it with the
// user-context client so auth.uid() is the caller.
export async function POST(request, { params }) {
  const { unauthorized } = await requireTeam();
  if (unauthorized) {
    return NextResponse.json({ error: 'Team access required.' }, { status: 401 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  const text = String(body.body || '').trim();
  if (!text) return NextResponse.json({ error: 'Update text is required.' }, { status: 400 });
  if (body.status && !STATUS_VALUES.has(body.status)) {
    return NextResponse.json({ error: 'Invalid status.' }, { status: 400 });
  }
  let percent = null;
  if (body.percent !== null && body.percent !== undefined && body.percent !== '') {
    percent = Math.round(Number(body.percent));
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      return NextResponse.json({ error: 'percent must be 0-100.' }, { status: 400 });
    }
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('post_task_update', {
    p_task_id: id,
    p_body: text,
    p_status: body.status || null,
    p_percent: percent,
  });

  if (error) {
    // 42501 = the RPC refused (not a member / not this task's assignee).
    const denied = error.code === '42501';
    return NextResponse.json(
      { error: denied ? 'Not authorized for this task.' : error.message },
      { status: denied ? 403 : 400 },
    );
  }
  return NextResponse.json({ task: data }, { status: 201 });
}
