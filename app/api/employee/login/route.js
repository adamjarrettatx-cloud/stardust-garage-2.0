import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import {
  handle,
  body,
  db,
  json,
  limit,
  sameOrigin,
  assertEnabled,
  ClockError,
} from "@/lib/time-clock/server";
import { parseIdentifier, employeeAuthEmail } from "@/lib/time-clock/employee.mjs";
import { STATION_COOKIE } from "@/lib/station-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INVALID = "Incorrect username/email or password.";

// Employee portal sign-in by username or email. Uses the normal Supabase
// password session (cookies), then requires an enabled, active staff-profile
// link. Anything else signs straight back out with the same generic error.
export async function POST(request) {
  return handle(async () => {
    sameOrigin(request);
    assertEnabled();
    const input = await body(request);
    const id = parseIdentifier(input.identifier);
    const password = input.password;
    if (!id || typeof password !== "string" || !password || password.length > 128)
      throw new ClockError(INVALID, 401, "invalid_login");
    const client = db();
    const ip =
      request.headers.get("x-vercel-forwarded-for") ||
      request.headers.get("x-forwarded-for") ||
      "unknown";
    await limit(client, "employee-login:global", 300, 900);
    await limit(client, `employee-login:ip:${ip}`, 40, 900);
    await limit(client, `employee-login:id:${id.email || id.username}`, 10, 900);

    let email = id.email;
    if (id.username) {
      const { data, error } = await client
        .from("tc_workers")
        .select("user_id")
        .eq("username", id.username)
        .maybeSingle();
      if (error) throw new ClockError("Sign-in is temporarily unavailable.", 503);
      if (data?.user_id) {
        const { data: u } = await client.auth.admin.getUserById(data.user_id);
        email = u?.user?.email || null;
      }
    }
    const supabase = await createClient();
    // Unknown usernames still run the provider password check (uniform path).
    const { data: signed, error: authError } = await supabase.auth.signInWithPassword({
      email: email || employeeAuthEmail(randomUUID()),
      password,
    });
    const userId = signed?.user?.id;
    let linked = null;
    if (!authError && userId) {
      const { data } = await client
        .from("tc_workers")
        .select("id")
        .eq("user_id", userId)
        .eq("active", true)
        .eq("login_enabled", true)
        .maybeSingle();
      linked = data;
    }
    if (authError || !userId || !linked || signed.user.app_metadata?.station_account) {
      if (userId) await supabase.auth.signOut();
      throw new ClockError(INVALID, 401, "invalid_login");
    }
    const response = json({ destination: "/employee" });
    // Never leave a shared station session underneath a personal login.
    if (request.cookies?.get(STATION_COOKIE)) {
      response.cookies.set(STATION_COOKIE, "", { path: "/", maxAge: 0, secure: true });
    }
    return response;
  });
}
