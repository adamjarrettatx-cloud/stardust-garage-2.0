import { createClient } from '@/lib/supabase/server';

// Server-side helper. Returns the current user along with a derived
// `isAdmin` flag based on the raw_user_meta_data set via SQL or admin UI.
//
// Usage from a server component:
//   const { user, isAdmin } = await getCurrentUser();
//   if (!user) return null;             // not logged in
//   if (!isAdmin) redirect('/member');  // logged in but not admin
export async function getCurrentUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { user: null, isAdmin: false };
  }

  const isAdmin = Boolean(user.user_metadata?.is_admin);
  return { user, isAdmin };
}
