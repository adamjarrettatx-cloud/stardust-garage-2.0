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
import { validScheduleEntry } from "@/lib/time-clock/schedule.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_RANGE_MS = 400 * 86400000;
function entry(e) {
  try {
    return validScheduleEntry(e);
  } catch (err) {
    throw new ClockError(err.message);
  }
}

// Manager-only schedule read for the calendar's visible window.
export async function GET(request) {
  return handle(async () => {
    await manager(request);
    const url = new URL(request.url);
    const from = Date.parse(url.searchParams.get("from") || "");
    const to = Date.parse(url.searchParams.get("to") || "");
    if (
      !Number.isFinite(from) ||
      !Number.isFinite(to) ||
      from > to ||
      to - from > MAX_RANGE_MS
    )
      throw new ClockError("Choose a schedule range of up to 400 days.");
    const { data, error } = await db()
      .from("tc_schedule")
      .select("id,worker_id,role_id,starts_at,ends_at,note,version")
      .lt("starts_at", new Date(to).toISOString())
      .gt("ends_at", new Date(from).toISOString())
      .order("starts_at")
      .limit(3000);
    if (error)
      throw new ClockError("Schedule is temporarily unavailable.", 503);
    return json({ entries: data });
  });
}

export async function POST(request) {
  return handle(async () => {
    const actor = await manager(request, true),
      input = await body(request),
      p = input.payload || {};
    let action, payload;
    if (input.action === "create") {
      if (!Array.isArray(p.entries) || !p.entries.length || p.entries.length > 40)
        throw new ClockError("Add between 1 and 40 people to this shift.");
      action = "create_schedule";
      payload = { entries: p.entries.map(entry) };
      if (new Set(payload.entries.map((e) => e.worker_id)).size !== payload.entries.length)
        throw new ClockError("Each person can be added once per shift.");
    } else if (input.action === "update") {
      if (!UUID.test(p.id ?? "")) throw new ClockError("Invalid shift ID.");
      if (!Number.isInteger(p.version) || p.version < 1)
        throw new ClockError("Refresh the schedule first.");
      action = "update_schedule";
      payload = { id: p.id, version: p.version, ...entry(p) };
    } else if (input.action === "delete") {
      if (!UUID.test(p.id ?? "")) throw new ClockError("Invalid shift ID.");
      action = "delete_schedule";
      payload = { id: p.id };
    } else throw new ClockError("Invalid action.");
    const result = await rpc(db(), "tc_schedule_admin", {
      p_actor: actor.id,
      p_action: action,
      p_payload: payload,
    });
    return json(result);
  });
}
