// SERVER ONLY. Shared employee sign-in check for the website (cookie session)
// and the mobile app (token session). Same generic error for every failure.
import { randomUUID } from "node:crypto";
import { db, limit, ClockError } from "./server";
import { parseIdentifier, employeeAuthEmail } from "./employee.mjs";

export const INVALID_LOGIN = "Incorrect username/email or password.";

// `supabase` is the Auth client whose session should be established: the
// cookie-bound server client on the web, or a stateless client for mobile.
export async function employeeSignIn(request, supabase, input) {
  const id = parseIdentifier(input.identifier);
  const password = input.password;
  if (!id || typeof password !== "string" || !password || password.length > 128)
    throw new ClockError(INVALID_LOGIN, 401, "invalid_login");
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
    if (userId) await supabase.auth.signOut({ scope: "local" });
    throw new ClockError(INVALID_LOGIN, 401, "invalid_login");
  }
  return signed;
}
