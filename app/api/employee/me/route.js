import { getRequestUser } from "@/lib/auth-helpers";
import {
  handle,
  db,
  rpc,
  json,
  assertEnabled,
  ClockError,
} from "@/lib/time-clock/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Personal employee view: the verified Auth user's own linked staff profile
// only. The browser cannot choose whose data is returned.
export async function GET(request) {
  return handle(async () => {
    assertEnabled();
    const user = await getRequestUser(request);
    if (!user) throw new ClockError("Sign in to view your schedule.", 401, "not_signed_in");
    const url = new URL(request.url);
    const days = Number(url.searchParams.get("days") || 14);
    if (![7, 14, 31, 93].includes(days)) throw new ClockError("Choose 7, 14, 31 or 93 days.");
    const to = new Date();
    const from = new Date(to.getTime() - days * 86400000);
    const view = await rpc(db(), "tc_employee_view", {
      p_user: user.id,
      p_from: from.toISOString(),
      p_to: to.toISOString(),
    });
    if (!view)
      throw new ClockError(
        "This account is not linked to an active staff profile. Ask a manager to enable your employee login.",
        403,
        "not_employee",
      );
    return json({ ...view, from: from.toISOString(), to: to.toISOString() });
  });
}
