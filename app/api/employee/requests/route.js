import { getRequestUser } from "@/lib/auth-helpers";
import {
  handle,
  body,
  db,
  rpc,
  json,
  limit,
  assertEnabled,
  employeeWriteGuard,
  ClockError,
} from "@/lib/time-clock/server";
import { UUID } from "@/lib/time-clock/core.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ISO_WITH_OFFSET = /(Z|[+-]\d{2}:\d{2})$/;
const KINDS = ["edit_shift", "missed_shift", "time_off"];

function instant(value) {
  if (typeof value !== "string" || !ISO_WITH_OFFSET.test(value) || !Number.isFinite(Date.parse(value)))
    throw new ClockError("Times must include a UTC offset.");
  return new Date(value).toISOString();
}

// Employee self-service requests: fix recorded hours, add a missed shift,
// request time off, or cancel an open request. Identity is the verified
// session user; the worker is resolved in the database, never from input.
export async function POST(request) {
  return handle(async () => {
    employeeWriteGuard(request);
    assertEnabled();
    const user = await getRequestUser(request);
    if (!user) throw new ClockError("Sign in again to send a request.", 401, "not_signed_in");
    const input = await body(request);
    const client = db();
    await limit(client, `employee-request:${user.id}`, 30, 3600);

    let payload;
    if (input.action === "cancel") {
      if (!UUID.test(input.id ?? "")) throw new ClockError("Invalid request.");
      payload = { id: input.id };
    } else if (input.action === "create") {
      if (!KINDS.includes(input.kind)) throw new ClockError("Choose a request type.");
      if (typeof input.reason !== "string" || input.reason.trim().length < 3 || input.reason.length > 500)
        throw new ClockError("Add a short reason (3–500 characters).");
      payload = {
        kind: input.kind,
        starts_at: instant(input.starts_at),
        ends_at: instant(input.ends_at),
        reason: input.reason.trim(),
      };
      if (input.kind === "edit_shift") {
        if (!UUID.test(input.shift_id ?? "")) throw new ClockError("Choose a worked shift.");
        payload.shift_id = input.shift_id;
      }
      if (input.kind === "missed_shift") {
        if (!/^[a-z_]{2,40}$/.test(input.role_id ?? "")) throw new ClockError("Choose the role you worked.");
        payload.role_id = input.role_id;
      }
    } else {
      throw new ClockError("Invalid action.");
    }
    const result = await rpc(client, "tc_employee_request", {
      p_user: user.id,
      p_action: input.action,
      p_payload: payload,
    });
    return json(result);
  });
}
