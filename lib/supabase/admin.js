import { createClient as createSupabaseClient } from '@supabase/supabase-js';

// Service-role Supabase client. NEVER import this from a client component or
// any file that is bundled to the browser. Used only inside route handlers
// (app/api/**) after requireAdmin() has gated the request.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL');
  }
  return createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
