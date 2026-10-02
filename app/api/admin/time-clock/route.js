import {
  handle,
  manager,
  body,
  db,
  rpc,
  hash,
  json,
  ClockError,
} from "@/lib/time-clock/server";
import { newPin, pairingCode, hashPin } from "@/lib/time-clock/crypto.mjs";
import { UUID, shiftsCsv } from "@/lib/time-clock/core.mjs";
import { isValidPin } from "@/lib/time-clock/pin.mjs";
import { isInternalEmployeeEmail } from "@/lib/time-clock/employee.mjs";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const safeWorkerColumns =
  "id,name,category,active,pay_basis,flat_cents,created_at,user_id,username,login_enabled,login_managed";
// Display-only email for linked employee logins. Internal placeholder
// addresses for username-only logins are never shown.
async function withLoginEmails(client, workers) {
  return Promise.all(
    workers.map(async ({ user_id, ...w }) => {
      let login_email = null;
      if (user_id) {
        const { data } = await client.auth.admin.getUserById(user_id).catch(() => ({}));
        const email = data?.user?.email || null;
        login_email = email && !isInternalEmployeeEmail(email) ? email : null;
      }
      return { ...w, has_login: Boolean(user_id), login_email };
    }),
  );
}
function assignedPin(value) {
  if (value === undefined || value === "") return newPin();
  if (!isValidPin(value))
    throw new ClockError(
      "Choose exactly four digits, or leave PIN blank to generate one.",
    );
  return value;
}
function checked(result) {
  if (result.error)
    throw new ClockError("Timekeeping is temporarily unavailable.", 503);
  return result.data;
}
export async function GET(request) {
  return handle(async () => {
    await manager(request);
    const client = db(),
      url = new URL(request.url);
    if (url.searchParams.has("shift")) {
      const id = url.searchParams.get("shift");
      if (!UUID.test(id)) throw new ClockError("Invalid shift ID.");
      return json({
        shift: await rpc(client, "tc_shift_view", { p_id: id, p_owner: true }),
      });
    }
    // Explicit UTC boundaries supplied by the owner UI, capped at 93 days.
    const from = Date.parse(
      url.searchParams.get("from") ||
        new Date(Date.now() - 14 * 86400000).toISOString(),
    );
    const to = Date.parse(
      url.searchParams.get("to") || new Date().toISOString(),
    );
    if (
      !Number.isFinite(from) ||
      !Number.isFinite(to) ||
      from > to ||
      to - from > 93 * 86400000
    )
      throw new ClockError("Choose a range of up to 93 days.");
    const shifts = checked(
      await client
        .from("tc_shifts")
        .select("id,started_at")
        .gte("started_at", new Date(from).toISOString())
        .lte("started_at", new Date(to).toISOString())
        .order("started_at", { ascending: false })
        .limit(501),
    );
    if (shifts.length > 500)
      throw new ClockError(
        "More than 500 shifts match. Narrow the date range before viewing or exporting.",
        400,
      );
    // One batched query per nested relation; no per-row HTTP fan-out.
    const ids = shifts.map((s) => s.id);
    const raw = ids.length
      ? checked(
          await client
            .from("tc_shifts")
            .select(
              "id,worker_id,started_at,ended_at,status,version,pay_basis,flat_cents,note,tc_workers(name,category),tc_segments(*),tc_tasks(*),tc_breaks(*)",
            )
            .in("id", ids)
            .order("started_at", { ascending: false }),
        )
      : [];
    const rows = raw.map(
      ({ tc_workers: w, tc_segments, tc_tasks, tc_breaks, ...s }) => ({
        ...s,
        worker_name: w?.name ?? "Unknown",
        category: w?.category ?? "",
        segments: (tc_segments || []).sort(
          (a, b) => Date.parse(a.started_at) - Date.parse(b.started_at),
        ),
        tasks: tc_tasks || [],
        breaks: tc_breaks || [],
      }),
    );
    const status = url.searchParams.get("status");
    const name = (url.searchParams.get("name") || "").toLowerCase();
    const filtered = rows.filter(
      (s) =>
        (!status || status === "all" || s.status === status) &&
        s.worker_name.toLowerCase().includes(name),
    );
    if (url.searchParams.get("format") === "csv") {
      return new NextResponse(shiftsCsv(filtered), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="sdg-timekeeping.csv"',
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    const workers = await withLoginEmails(
      client,
      checked(
        await client.from("tc_workers").select(safeWorkerColumns).order("name"),
      ),
    );
    const roles = checked(
      await client
        .from("tc_roles")
        .select("id,name,tasks,active")
        .order("name"),
    );
    const assignments = checked(
      await client
        .from("tc_assignments")
        .select("worker_id,role_id,rate_cents"),
    );
    const kiosks = checked(
      await client
        .from("tc_kiosks")
        .select("id,label,created_at,pairing_expires,expires_at,revoked_at")
        .order("created_at", { ascending: false }),
    );
    const open = checked(
      await client
        .from("tc_shifts")
        .select("id,worker_id,started_at")
        .is("ended_at", null)
        .order("started_at"),
    );
    await rpc(client, "tc_cleanup");
    return json({
      shifts: filtered,
      workers,
      roles,
      assignments,
      kiosks,
      open,
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
    });
  });
}
export async function POST(request) {
  return handle(async () => {
    const actor = await manager(request, true),
      input = await body(request),
      client = db();
    const action = input.action,
      p = input.payload || {};
    let payload,
      disclosure = {};
    if (action === "save_role") {
      if (
        !/^[a-z_]{2,40}$/.test(p.id ?? "") ||
        typeof p.name !== "string" ||
        !p.name.trim() ||
        p.name.trim().length > 80 ||
        typeof p.active !== "boolean" ||
        !Array.isArray(p.tasks) ||
        p.tasks.length > 30 ||
        p.tasks.some(
          (t) => typeof t !== "string" || !t.trim() || t.trim().length > 240,
        ) ||
        new Set(p.tasks.map((t) => t.trim())).size !== p.tasks.length
      )
        throw new ClockError(
          "Choose a role ID, name, and up to 30 unique responsibilities.",
        );
      payload = {
        id: p.id,
        name: p.name.trim(),
        active: p.active,
        tasks: p.tasks.map((t) => t.trim()),
      };
    } else if (action === "save_worker") {
      if (
        typeof p.name !== "string" ||
        !p.name.trim() ||
        p.name.trim().length > 120
      )
        throw new ClockError("A name is required (up to 120 characters).");
      if (
        !["employee", "contractor"].includes(p.category) ||
        !["unset", "hourly", "flat"].includes(p.pay_basis)
      )
        throw new ClockError("Choose worker category and pay basis.");
      if (p.id && !UUID.test(p.id)) throw new ClockError("Invalid worker ID.");
      if (typeof p.active !== "boolean")
        throw new ClockError("Invalid active setting.");
      if (
        !Array.isArray(p.roles) ||
        p.roles.length > 30 ||
        new Set(p.roles.map((r) => r.role_id)).size !== p.roles.length
      )
        throw new ClockError("Choose unique role assignments.");
      const roles = p.roles.map((r) => {
        if (
          !/^[a-z_]{2,40}$/.test(r.role_id ?? "") ||
          !(
            r.rate_cents === null ||
            (Number.isInteger(r.rate_cents) &&
              r.rate_cents >= 0 &&
              r.rate_cents <= 100000000)
          )
        )
          throw new ClockError("Invalid role rate.");
        return { role_id: r.role_id, rate_cents: r.rate_cents };
      });
      if (
        p.pay_basis === "flat" &&
        (!Number.isInteger(p.flat_cents) ||
          p.flat_cents < 0 ||
          p.flat_cents > 100000000)
      )
        throw new ClockError("Enter a valid flat shift fee.");
      payload = {
        id: p.id || null,
        name: p.name.trim(),
        category: p.category,
        active: p.active,
        pay_basis: p.pay_basis,
        flat_cents: p.pay_basis === "flat" ? p.flat_cents : null,
        roles,
      };
      if (!p.id) {
        const pin = assignedPin(p.pin);
        payload.pin_lookup = hash("pin-lookup", pin);
        payload.pin_verifier = await hashPin(
          pin,
          process.env.TIME_CLOCK_SECRET,
        );
        disclosure = { pin }; // Returned once to the gated manager; never persisted plaintext.
      } else if (p.pin !== undefined && p.pin !== "") {
        throw new ClockError(
          "Use Reset PIN to change an existing profile's PIN.",
        );
      }
    } else if (action === "reset_pin") {
      if (!UUID.test(p.id ?? "")) throw new ClockError("Invalid worker ID.");
      const pin = assignedPin(p.pin);
      payload = {
        id: p.id,
        pin_lookup: hash("pin-lookup", pin),
        pin_verifier: await hashPin(pin, process.env.TIME_CLOCK_SECRET),
      };
      disclosure = { pin };
    } else if (action === "create_kiosk") {
      if (typeof p.label !== "string" || !p.label.trim() || p.label.length > 80)
        throw new ClockError("Enter a device name.");
      const code = pairingCode();
      payload = { label: p.label.trim(), pairing_hash: hash("pair", code) };
      disclosure = { pairing_code: code };
    } else if (["revoke_kiosk", "approve", "correct"].includes(action)) {
      if (!UUID.test(p.id ?? "")) throw new ClockError("Invalid record ID.");
      payload = { id: p.id };
      if (action !== "revoke_kiosk") {
        if (!Number.isInteger(p.version) || p.version < 1)
          throw new ClockError("Refresh the shift first.");
        if (
          typeof p.reason !== "string" ||
          p.reason.length > 2000 ||
          (action === "correct" && p.reason.trim().length < 5)
        )
          throw new ClockError(
            "Add a review/correction reason (up to 2,000 characters).",
          );
        payload.version = p.version;
        payload.reason = p.reason.trim();
      }
      if (action === "correct") {
        for (const key of ["started_at", "ended_at"]) {
          if (
            typeof p[key] !== "string" ||
            !/(Z|[+-]\d{2}:\d{2})$/.test(p[key]) ||
            !Number.isFinite(Date.parse(p[key]))
          )
            throw new ClockError("Times must include a UTC offset.");
          payload[key] = new Date(p[key]).toISOString();
        }
      }
    } else throw new ClockError("Invalid action.");
    const result = await rpc(client, "tc_admin", {
      p_actor: actor.id,
      p_action: action,
      p_payload: payload,
    });
    return json({ ...result, ...disclosure });
  });
}
