import { createClient } from '@/lib/supabase/server';

// Server-side helper. Returns the current user along with a derived
// `isAdmin` flag.
//
// SECURITY: `isAdmin` is sourced from the server-controlled `team_members`
// table (role = 'admin'), NOT from `user_metadata.is_admin`. Per Supabase
// advisor 0015, user_metadata is editable by end users and must not be used
// in a security context. The middleware still falls back to user_metadata
// for the broad gate so we don't break existing pages, but every sensitive
// path MUST call requireAdmin() which uses team_members.
export async function getCurrentUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { user: null, isAdmin: false };
  }

  // Source of truth: team_members.role = 'admin'
  const { data: tm } = await supabase
    .from('team_members')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();

  const isAdmin = tm?.role === 'admin';
  return { user, isAdmin, teamRole: tm?.role || null };
}

// Throws (returns null) if not admin. For API routes that need a hard gate.
export async function requireAdmin() {
  const { user, isAdmin } = await getCurrentUser();
  if (!user || !isAdmin) return { user: null, isAdmin: false, unauthorized: true };
  return { user, isAdmin: true, unauthorized: false };
}
