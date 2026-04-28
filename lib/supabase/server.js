import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createStubClient, isSupabaseConfigured } from './stub';

export async function createClient() {
  if (!isSupabaseConfigured()) {
    return createStubClient();
  }

  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from Server Component — cookies can't be set here.
            // Safe to ignore if you have middleware refreshing sessions.
          }
        },
      },
    }
  );
}