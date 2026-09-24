import { requireTeam, requireAdminMfa } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { w9Json, w9Enabled, isW9Reviewer, loadW9History } from '@/lib/w9/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request, { params }) {
  const { user, unauthorized } = await requireTeam();
  if (unauthorized) return w9Json({ error: 'Team access required.' }, 401);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return w9Json({ error: 'Invalid contact.' }, 400);
  const admin = createAdminClient();
  try {
    const enabled = await w9Enabled(admin);
    const canReview = await isW9Reviewer(admin, user.id);
    // General staff receive readiness only, never document IDs, reasons or tax data.
    const { data: approval, error: approvalError } = await admin.from('w9_submissions')
      .select('id').eq('contact_id', id).eq('status', 'approved').limit(1).maybeSingle();
    if (approvalError) throw new Error('unavailable');
    let submissions = [];
    if (canReview) {
      const mfa = await requireAdminMfa();
      if (mfa.unauthorized) return w9Json({ error: 'Administrator verification required.' }, 403);
      submissions = await loadW9History(admin, id);
    }
    const status = approval ? 'approved' : (submissions[0]?.status || 'missing');
    return w9Json({ enabled, canReview, status, submissions });
  } catch {
    return w9Json({ error: 'W-9 status is temporarily unavailable.' }, 503);
  }
}

export async function PATCH() {
  const { unauthorized } = await requireAdminMfa();
  if (unauthorized) return w9Json({ error: 'Unauthorized.' }, 401);
  return w9Json({ error: 'Manual uploads cannot approve a W-9. Review the artist’s signed submission instead.' }, 409);
}
