import { handle, manager, db, rpc, json, ClockError } from "@/lib/time-clock/server";
import { UUID } from "@/lib/time-clock/core.mjs";
import { periodRange } from "@/lib/time-clock/periods.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Read-only "View as employee": the same payload the employee's own portal
// receives, for any active staff profile. Manager-only (Adam/Jeyu + MFA
// policy). No session is created or borrowed and nothing can be written.
export async function GET(request) {
  return handle(async () => {
    await manager(request);
    const url = new URL(request.url);
    const worker = url.searchParams.get("worker") || "";
    if (!UUID.test(worker)) throw new ClockError("Choose a staff profile.");
    const range = periodRange(url.searchParams.get("from"), url.searchParams.get("to"));
    if (!range) throw new ClockError("Choose a period of up to 93 days.");
    const view = await rpc(db(), "tc_employee_preview", { p_worker: worker, p_from: range.from, p_to: range.to });
    if (!view) throw new ClockError("That staff profile is inactive or no longer exists.", 404, "not_found");
    return json({ ...view, from: range.from, to: range.to });
  });
}
