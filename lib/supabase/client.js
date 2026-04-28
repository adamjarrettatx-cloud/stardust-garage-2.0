import { createBrowserClient } from '@supabase/ssr';
import { createStubClient, isSupabaseConfigured } from './stub';

export function createClient() {
  if (!isSupabaseConfigured()) {
    return createStubClient();
  }

  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}