import { createClient } from "@/lib/supabase/server";
import { handle, json, sameOrigin } from "@/lib/time-clock/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  return handle(async () => {
    sameOrigin(request);
    const supabase = await createClient();
    await supabase.auth.signOut();
    return json({ destination: "/employee/login" });
  });
}
