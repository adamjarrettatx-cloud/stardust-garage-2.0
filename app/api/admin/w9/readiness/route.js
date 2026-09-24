import { requireTeam } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { w9Enabled, w9Json } from '@/lib/w9/server';
export const dynamic = 'force-dynamic';
export async function GET() {
  const { unauthorized } = await requireTeam();
  if (unauthorized) return w9Json({ error: 'Team access required.' }, 401);
  const admin = createAdminClient();
  try {
    const enabled = await w9Enabled(admin);
    if (!enabled) return w9Json({ enabled, approvedContactIds: [] });
    const { data, error } = await admin.from('w9_submissions').select('contact_id').eq('status', 'approved');
    if (error) throw new Error('unavailable');
    return w9Json({ enabled, approvedContactIds: data.map(row => row.contact_id) });
  } catch { return w9Json({ error: 'Could not verify artist W-9 readiness.' }, 503); }
}
