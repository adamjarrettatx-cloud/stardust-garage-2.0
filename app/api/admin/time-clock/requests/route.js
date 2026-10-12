import {
  handle,
  manager,
  body,
  db,
  rpc,
  json,
  ClockError,
} from "@/lib/time-clock/server";
import { UUID } from "@/lib/time-clock/core.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ISO_WITH_OFFSET = /(Z|[+-]\d{2}:\d{2})$/;
const STATUSES = ["pending", "approved", "denied", "cancelled", "time_off", "all"];

// Manager approval queue for employee requests (Adam/Jeyu + MFA policy).
export async function GET(request) {
  return handle(async () => {
    await manager(request);
    const status = new URL(request.url).searchParams.get("status") || "pending";
    if (!STATUSES.includes(status)) throw new ClockError("Invalid filter.");
    const client = db();
    const [requests, pending] = await Promise.all([
      rpc(client, "tc_requests_view", { p_status: status, p_limit: 200 }),
      status === "pending" ? null : rpc(client, "tc_requests_view", { p_status: "pending", p_limit: 300 }),
    ]);
    return json({ requests, pending_count: (pending ?? requests).length });
  });
}

export async function POST(request) {
  return handle(async () => {
    const actor = await manager(request, true);
    const input = await body(request);
    if (!["approve", "deny", "revoke_time_off"].includes(input.action)) throw new ClockError("Invalid action.");
    if (!UUID.test(input.id ?? "") || !Number.isInteger(input.version)) throw new ClockError("Invalid request.");
    if (input.note !== undefined && (typeof input.note !== "string" || input.note.length > 500))
      throw new ClockError("Keep the note under 500 characters.");
    const payload = { id: input.id, version: input.version, note: (input.note || "").trim() };
    for (const key of ["starts_at", "ends_at"]) {
      if (input[key] === undefined || input[key] === null) continue;
      if (input.action !== "approve" || typeof input[key] !== "string" || !ISO_WITH_OFFSET.test(input[key]) || !Number.isFinite(Date.parse(input[key])))
        throw new ClockError("Adjusted times must include a UTC offset.");
      payload[key] = new Date(input[key]).toISOString();
    }
    const result = await rpc(db(), "tc_request_admin", {
      p_actor: actor.id,
      p_action: input.action,
      p_payload: payload,
    });
    return json(result);
  });
}
