import { getRequestUser } from "@/lib/auth-helpers";
import {
  handle,
  db,
  rpc,
  json,
  assertEnabled,
  ClockError,
} from "@/lib/time-clock/server";
import { periodRange } from "@/lib/time-clock/periods.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Personal employee view: the verified Auth user's own linked staff profile
// only. The browser cannot choose whose data is returned. Accepts an Austin
// day range (?from=YYYY-MM-DD&to=YYYY-MM-DD, up to 93 days) or ?days=.
export async function GET(request) {
  return handle(async () => {
    assertEnabled();
    const user = await getRequestUser(request);
    if (!user) throw new ClockError("Sign in to view your schedule.", 401, "not_signed_in");
    const url = new URL(request.url);
    let from, to;
    if (url.searchParams.has("from") || url.searchParams.has("to")) {
      const range = periodRange(url.searchParams.get("from"), url.searchParams.get("to"));
      if (!range) throw new ClockError("Choose a period of up to 93 days.");
      ({ from, to } = range);
    } else {
      const days = Number(url.searchParams.get("days") || 14);
      if (![7, 14, 31, 93].includes(days)) throw new ClockError("Choose 7, 14, 31 or 93 days.");
      to = new Date().toISOString();
      from = new Date(Date.now() - days * 86400000).toISOString();
    }
    const view = await rpc(db(), "tc_employee_view", { p_user: user.id, p_from: from, p_to: to });
    if (!view)
      throw new ClockError(
        "This account is not linked to an active staff profile. Ask a manager to enable your employee login.",
        403,
        "not_employee",
      );
    return json({ ...view, from, to });
  });
}
