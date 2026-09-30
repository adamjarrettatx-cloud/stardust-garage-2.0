import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

let db, worker, kiosk, version;
const actor = "11111111-1111-4111-8111-111111111111";
const device = "d".repeat(64),
  session = "s".repeat(64);
async function call(name, values = []) {
  return (
    await db.query(
      `select public.${name}(${values.map((_, i) => `$${i + 1}`).join(",")}) as result`,
      values,
    )
  ).rows[0].result;
}
const admin = (action, payload) =>
  call("tc_admin", [actor, action, JSON.stringify(payload)]);
const op = (action, payload = {}, request = randomUUID()) =>
  call("tc_operate", [
    device,
    session,
    request,
    action,
    JSON.stringify(payload),
  ]);
const state = () => call("tc_state", [device, session, false]);
const begin = () => op("clock_in", { role_id: "bartender" });
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key); insert into auth.users values('${actor}');`);
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20260930031000_staff_time_clock.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
}, 30000);
beforeEach(async () => {
  await db.exec("truncate tc_workers,tc_kiosks,tc_limits cascade;");
  const created = await admin("save_worker", {
    name: "Test Worker",
    category: "employee",
    active: true,
    pay_basis: "hourly",
    flat_cents: null,
    pin_lookup: "p".repeat(64),
    pin_verifier: "test-only-hash",
    roles: [
      { role_id: "bartender", rate_cents: 2200 },
      { role_id: "floor_support", rate_cents: 1800 },
    ],
  });
  worker = created.id;
  version = (
    await db.query("select credential_version from tc_workers where id=$1", [
      worker,
    ])
  ).rows[0].credential_version;
  kiosk = (
    await admin("create_kiosk", {
      label: "Test kiosk",
      pairing_hash: "c".repeat(64),
    })
  ).id;
  await call("tc_pair", ["c".repeat(64), device]);
  await call("tc_start_session", [device, worker, version, session]);
});
afterAll(async () => {
  await db?.close();
});

it("records server time, rate snapshot, assigned tasks and immutable raw punch", async () => {
  const { shift } = await begin();
  expect(shift.worker_id).toBe(worker);
  expect(shift.tasks).toHaveLength(3);
  expect(shift.segments[0]).not.toHaveProperty("rate_cents");
  const detail = await call("tc_shift_view", [shift.id, true]);
  expect(detail.segments[0].rate_cents).toBe(2200);
  expect(detail.audit.map((a) => a.action)).toContain("clock_in");
  await expect(db.exec(`update tc_audit set action='changed'`)).rejects.toThrow(
    "audit_is_immutable",
  );
});
it("retries exactly once and rejects a reused key with different intent", async () => {
  const id = randomUUID(),
    first = await op("clock_in", { role_id: "bartender" }, id);
  const retries = await Promise.all([
    op("clock_in", { role_id: "bartender" }, id),
    op("clock_in", { role_id: "bartender" }, id),
  ]);
  expect(retries[0]).toEqual(first);
  expect(retries[1]).toEqual(first);
  expect((await db.query("select * from tc_shifts")).rows).toHaveLength(1);
  await expect(
    op("clock_in", { role_id: "floor_support" }, id),
  ).rejects.toThrow("request_conflict");
});
it("blocks duplicate open shifts, even under different assigned roles", async () => {
  await begin();
  await expect(op("clock_in", { role_id: "floor_support" })).rejects.toThrow(
    "shift_already_open",
  );
});
it("will not accept an unassigned role", async () => {
  await expect(op("clock_in", { role_id: "front_door" })).rejects.toThrow(
    "role_not_assigned",
  );
  expect((await db.query("select * from tc_shifts")).rows).toHaveLength(0);
});
it("switches roles atomically with identical boundary timestamps and captured rates", async () => {
  const { shift } = await begin();
  await op("switch_role", { shift_id: shift.id, role_id: "floor_support" });
  const detail = await call("tc_shift_view", [shift.id, true]);
  expect(detail.segments).toHaveLength(2);
  expect(detail.segments[0].ended_at).toBe(detail.segments[1].started_at);
  expect(detail.segments.map((x) => x.rate_cents)).toEqual([2200, 1800]);
  expect(detail.tasks).toHaveLength(6);
});
it("logs counted breaks, disallows switching on break, and closes a break on clock-out", async () => {
  const { shift } = await begin();
  await op("break_start", { shift_id: shift.id });
  await expect(
    op("switch_role", { shift_id: shift.id, role_id: "floor_support" }),
  ).rejects.toThrow("end_break_first");
  const closed = (
    await op("clock_out", {
      shift_id: shift.id,
      note: "Closing left for lead.",
    })
  ).shift;
  expect(closed.tasks.every((t) => !t.done)).toBe(true);
  expect(closed.status).toBe("pending");
  expect(closed.breaks[0].ended_at).toBe(closed.ended_at);
  expect(closed.breaks[0].paid).toBe(true);
});
it("rejects stale shift IDs rather than acting on the new shift", async () => {
  const { shift } = await begin();
  await op("clock_out", { shift_id: shift.id, note: "" });
  await begin();
  await expect(op("break_start", { shift_id: shift.id })).rejects.toThrow(
    "shift_changed",
  );
});
it("updates only the current worker task and records its event", async () => {
  const { shift } = await begin();
  await op("task", {
    shift_id: shift.id,
    task_id: shift.tasks[0].id,
    done: true,
  });
  const updated = (await state()).shift;
  expect(updated.tasks.find((t) => t.id === shift.tasks[0].id).done).toBe(true);
  await expect(
    op("task", { shift_id: shift.id, task_id: randomUUID(), done: true }),
  ).rejects.toThrow("invalid_task");
});
it("never sends pay, verifiers or owner audit to kiosk state/history", async () => {
  const { shift } = await begin();
  await op("clock_out", { shift_id: shift.id, note: "" });
  const data = await state();
  expect(data.history).toHaveLength(1);
  for (const sensitive of [
    "rate_cents",
    "flat_cents",
    "pin_lookup",
    "pin_verifier",
    "credential_version",
    "actor_id",
    "audit",
  ]) {
    expect(JSON.stringify(data)).not.toContain(`"${sensitive}"`);
  }
});
it("expires sessions and limits sliding extension to fifteen minutes", async () => {
  await db.exec(
    `update tc_sessions set created_at=now()-interval '16 minutes',expires_at=now()+interval '90 seconds'`,
  );
  expect((await state()).authenticated).toBe(false);
  await expect(begin()).rejects.toThrow("not_authorized");
});
it("PIN reset immediately invalidates existing sessions and version races", async () => {
  await admin("reset_pin", {
    id: worker,
    pin_lookup: "n".repeat(64),
    pin_verifier: "new-hash",
  });
  expect((await state()).authenticated).toBe(false);
  await expect(
    call("tc_start_session", [device, worker, version, "z".repeat(64)]),
  ).rejects.toThrow("not_authorized");
});
it("refuses resetting to the same PIN without invalidating the current session", async () => {
  const current = (
    await db.query("select pin_lookup from tc_workers where id=$1", [worker])
  ).rows[0];
  await expect(
    admin("reset_pin", {
      id: worker,
      pin_lookup: current.pin_lookup,
      pin_verifier: "new-hash",
    }),
  ).rejects.toThrow("pin_unchanged");
  expect((await state()).authenticated).toBe(true);
});
it("device revocation blocks reads and punches without closing or deleting worked time", async () => {
  await begin();
  await admin("revoke_kiosk", { id: kiosk });
  await expect(state()).rejects.toThrow("device_not_authorized");
  await expect(begin()).rejects.toThrow("not_authorized");
  expect(
    (await db.query("select * from tc_shifts where ended_at is null")).rows,
  ).toHaveLength(1);
});
it("worker deactivation revokes PIN access but preserves an open shift for correction", async () => {
  await begin();
  await admin("save_worker", {
    id: worker,
    name: "Test Worker",
    category: "employee",
    active: false,
    pay_basis: "hourly",
    flat_cents: null,
    roles: [],
  });
  expect((await state()).authenticated).toBe(false);
  expect(
    (await db.query("select * from tc_shifts where ended_at is null")).rows,
  ).toHaveLength(1);
});
it("pairing codes are single use and expire", async () => {
  await expect(
    call("tc_pair", ["c".repeat(64), "e".repeat(64)]),
  ).rejects.toThrow("pairing_invalid");
  await admin("create_kiosk", { label: "Other", pairing_hash: "x".repeat(64) });
  await db.exec(
    `update tc_kiosks set pairing_expires=now()-interval '1 second' where pairing_hash is not null`,
  );
  await expect(
    call("tc_pair", ["x".repeat(64), "e".repeat(64)]),
  ).rejects.toThrow("pairing_invalid");
});
it("durable throttling survives rejected auth/punch transactions", async () => {
  expect(await call("tc_take_limit", ["test", 2, 60])).toBe(true);
  await expect(op("clock_in", { role_id: "front_door" })).rejects.toThrow();
  expect(await call("tc_take_limit", ["test", 2, 60])).toBe(true);
  expect(await call("tc_take_limit", ["test", 2, 60])).toBe(false);
});
it("captures old rates even after the owner changes assigned rates", async () => {
  const { shift } = await begin();
  await admin("save_worker", {
    id: worker,
    name: "Test Worker",
    category: "employee",
    active: true,
    pay_basis: "hourly",
    flat_cents: null,
    roles: [{ role_id: "bartender", rate_cents: 9900 }],
  });
  expect(
    (await call("tc_shift_view", [shift.id, true])).segments[0].rate_cents,
  ).toBe(2200);
});
it("approval uses optimistic version checks and cannot approve an open shift", async () => {
  const { shift } = await begin();
  await expect(
    admin("approve", { id: shift.id, version: shift.version, reason: "" }),
  ).rejects.toThrow("shift_still_open");
  const closed = (await op("clock_out", { shift_id: shift.id, note: "" }))
    .shift;
  await expect(
    admin("approve", { id: shift.id, version: shift.version, reason: "" }),
  ).rejects.toThrow("shift_changed");
  expect(
    (
      await admin("approve", {
        id: shift.id,
        version: closed.version,
        reason: "Reviewed.",
      })
    ).shift.status,
  ).toBe("approved");
});
it("correction preserves original punch, requires reason, and reopens approval", async () => {
  const { shift } = await begin();
  const closed = (await op("clock_out", { shift_id: shift.id, note: "" }))
    .shift;
  const approved = (
    await admin("approve", {
      id: shift.id,
      version: closed.version,
      reason: "",
    })
  ).shift;
  const patch = {
    id: shift.id,
    version: approved.version,
    started_at: new Date(Date.parse(shift.started_at) - 3600000).toISOString(),
    ended_at: closed.ended_at,
  };
  await expect(admin("correct", { ...patch, reason: "" })).rejects.toThrow(
    "reason_required",
  );
  const fixed = (
    await admin("correct", { ...patch, reason: "Missed actual starting time." })
  ).shift;
  expect(fixed.status).toBe("pending");
  expect(
    fixed.audit.find((a) => a.action === "correct").details.before.started_at,
  ).toBe(shift.started_at);
  expect(fixed.audit.filter((a) => a.action === "clock_in")).toHaveLength(1);
});
it("browser roles cannot read tables, invoke RPCs, or spoof an owner UUID", async () => {
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    await expect(db.query("select * from public.tc_workers")).rejects.toThrow(
      "permission denied",
    );
    await expect(
      admin("create_kiosk", {
        label: "unauthorized",
        pairing_hash: "f".repeat(64),
      }),
    ).rejects.toThrow("permission denied");
    await expect(state()).rejects.toThrow("permission denied");
    await db.exec("reset role");
  }
});
it("service can use the approved RPC but cannot rewrite tables directly", async () => {
  await db.exec("set role service_role");
  await expect(
    db.exec(`update public.tc_workers set active=false`),
  ).rejects.toThrow("permission denied");
  expect((await begin()).shift.worker_id).toBe(worker);
  await db.exec("reset role");
});
it("role template changes apply forward, not to historical checklists", async () => {
  const { shift } = await begin();
  await admin("save_role", {
    id: "bartender",
    name: "Bar",
    active: true,
    tasks: ["New closing duty"],
  });
  expect((await state()).shift.tasks).toHaveLength(3);
  await op("clock_out", { shift_id: shift.id, note: "" });
  const next = (await begin()).shift;
  expect(next.tasks.map((t) => t.title)).toEqual(["New closing duty"]);
  expect(next.segments[0].role_name).toBe("Bar");
  await admin("save_role", {
    id: "bartender",
    name: "Bartender",
    active: true,
    tasks: [
      "Check bar stock and ice",
      "Keep bar and service area clean",
      "Complete closing inventory",
    ],
  });
});
it("owner can close a forgotten punch with a reason without deleting the original", async () => {
  const { shift } = await begin();
  const updated = (
    await admin("correct", {
      id: shift.id,
      version: shift.version,
      started_at: shift.started_at,
      ended_at: new Date(Date.now()).toISOString(),
      reason: "Confirmed missed clock-out with worker.",
    })
  ).shift;
  expect(updated.status).toBe("pending");
  expect(updated.ended_at).toBeTruthy();
  expect(updated.audit[0].action).toBe("clock_in");
  expect((await state()).shift).toBeNull();
});
it("correction cannot overlap another shift or cut across a break", async () => {
  const first = (await begin()).shift;
  const firstClosed = (await op("clock_out", { shift_id: first.id, note: "" }))
    .shift;
  const second = (await begin()).shift;
  await op("break_start", { shift_id: second.id });
  const secondClosed = (
    await op("clock_out", { shift_id: second.id, note: "" })
  ).shift;
  await expect(
    admin("correct", {
      id: first.id,
      version: firstClosed.version,
      started_at: first.started_at,
      ended_at: new Date(Date.now()).toISOString(),
      reason: "Testing overlap rejection.",
    }),
  ).rejects.toThrow("shift_overlap");
  await expect(
    admin("correct", {
      id: second.id,
      version: secondClosed.version,
      started_at: second.started_at,
      ended_at: second.started_at,
      reason: "Testing break boundary rejection.",
    }),
  ).rejects.toThrow("correction_crosses_segment");
});
