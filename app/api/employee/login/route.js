import { createClient } from "@/lib/supabase/server";
import { handle, body, json, sameOrigin, assertEnabled } from "@/lib/time-clock/server";
import { employeeSignIn } from "@/lib/time-clock/employee-login";
import { STATION_COOKIE } from "@/lib/station-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Employee portal sign-in by username or email. Uses the normal Supabase
// password session (cookies), then requires an enabled, active staff-profile
// link. Anything else signs straight back out with the same generic error.
export async function POST(request) {
  return handle(async () => {
    sameOrigin(request);
    assertEnabled();
    const input = await body(request);
    await employeeSignIn(request, await createClient(), input);
    const response = json({ destination: "/employee" });
    // Never leave a shared station session underneath a personal login.
    if (request.cookies?.get(STATION_COOKIE)) {
      response.cookies.set(STATION_COOKIE, "", { path: "/", maxAge: 0, secure: true });
    }
    return response;
  });
}
