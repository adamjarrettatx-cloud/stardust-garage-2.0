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
import { staffPhotoUrls } from "@/lib/time-clock/invites";

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
    const client = db();
    const view = await rpc(client, "tc_employee_view", { p_user: user.id, p_from: from, p_to: to });
    if (!view)
      throw new ClockError(
        "This account is not linked to an active staff profile. Ask a manager to enable your employee login.",
        403,
        "not_employee",
      );
    // Profile completeness for the setup gate (birthday + private photo) and
    // the employee's own photo. If these columns are unavailable (e.g. an
    // older preview database), the portal simply does not gate.
    let profile = { complete: true, has_pin: true, has_birthdate: true, photo_url: null };
    const { data: own, error: ownError } = await (async () =>
      client.from("tc_workers").select("birthdate,photo_path,pin_lookup").eq("id", view.worker.id).maybeSingle())()
      .catch((error) => ({ error }));
    if (!ownError && own) {
      const photos = own.photo_path ? await staffPhotoUrls(client, [own.photo_path]) : new Map();
      profile = {
        complete: Boolean(own.birthdate && own.photo_path),
        has_birthdate: Boolean(own.birthdate),
        has_pin: Boolean(own.pin_lookup),
        photo_url: own.photo_path ? photos.get(own.photo_path) || null : null,
      };
    }
    return json({ ...view, profile, from, to });
  });
}
