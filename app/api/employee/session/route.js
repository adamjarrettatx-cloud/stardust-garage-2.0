import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { handle, body, json, assertEnabled, ClockError } from "@/lib/time-clock/server";
import { employeeSignIn } from "@/lib/time-clock/employee-login";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mobile app employee sign-in (username or email). Returns the Supabase
// session tokens to the app, which stores them in SecureStore. No cookies are
// set, so there is no ambient credential for a cross-site request to ride on.
export async function POST(request) {
  return handle(async () => {
    assertEnabled();
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
      throw new ClockError("Sign-in is temporarily unavailable.", 503);
    const input = await body(request);
    const supabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } },
    );
    const signed = await employeeSignIn(request, supabase, input);
    const session = signed.session;
    if (!session?.access_token || !session?.refresh_token)
      throw new ClockError("Sign-in is temporarily unavailable.", 503);
    return json({ access_token: session.access_token, refresh_token: session.refresh_token });
  });
}
