import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

// Manager "Delete shift" (tc_delete_shift): a wrong shift disappears from
// every view while the immutable audit log keeps who/when/why and a snapshot.
let db, worker, kiosk;
const actor = "11111111-1111-4111-8111-111111111111";
const mig = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const at = (hours) => new Date(Date.now() + hours * 3600000).toISOString();
async function call(name, values) {
  return (await db.query(`select public.${name}(${values.map((_, i) => `$${i + 1}`).join(",")}) as result`, values)).rows[0].result;
}
const admin = (action, payload) => call("tc_admin", [actor, action, JSON.stringify(payload)]);
const addHours = (payload) => call("tc_add_manual_shift", [actor, JSON.stringify(payload)]);
const del = (payload) => call("tc_delete_shift", [actor, JSON.stringify(payload)]);
const count = async (sql, args = []) => Number((await db.query(sql, args)).rows[0].n);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key, email text, raw_app_meta_data jsonb default '{}');
    create table public.team_members(user_id uuid, role text); create table public.partner_profiles(user_id uuid, is_active boolean);
    insert into auth.users(id,email) values('${actor}','owner@example.test');`);
  await db.exec(`
    grant usage on schema public to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant all on functions to anon,authenticated,service_role;
  `);
  for (const m of [
    "20260930031000_staff_time_clock.sql",
    "20261002160000_staff_schedule_employee_portal.sql",
    "20261011200000_employee_hub_requests.sql",
    "20261012150000_employee_view_preview.sql",
    "20261014150000_staff_email_invites.sql",
    "20261014220000_staff_birthdate_manager.sql",
    "20261016120000_manager_add_hours.sql",
    "20261017120000_manager_delete_shift.sql",
  ])
    await db.exec(mig(m));
}, 30000);

beforeEach(async () => {
  await db.exec("truncate tc_invites,tc_change_requests,tc_schedule,tc_workers,tc_kiosks,tc_limits cascade;");
  worker = (await admin("save_worker", {
    name: "Avery", category: "employee", active: true, pay_basis: "hourly", flat_cents: null,
    pin_lookup: "a".repeat(64), pin_verifier: "test-only-hash",
    roles: [{ role_id: "bartender", rate_cents: 2200 }],
  })).id;
  kiosk = (await admin("create_kiosk", { label: "Test", pairing_hash: "p".repeat(64) })).id;
});

// A runaway kiosk punch: clocked in, never clocked out for ~4 days.
async function runaway() {
  const s = (await db.query(
    "insert into tc_shifts(worker_id,kiosk_id,started_at,ended_at,pay_basis,status) values($1,$2,$3,$4,'hourly','pending') returning id,version",
    [worker, kiosk, at(-100), at(-4)],
  )).rows[0];
  await db.query("insert into tc_segments(shift_id,role_id,role_name,rate_cents,started_at,ended_at) values($1,'bartender','Bartender',2200,$2,$3)", [s.id, at(-100), at(-4)]);
  await db.query("insert into tc_breaks(shift_id,started_at,ended_at) values($1,$2,$3)", [s.id, at(-99), at(-98)]);
  await db.query("insert into tc_tasks(shift_id,role_id,title) values($1,'bartender','Stock ice')", [s.id]);
  await db.query("insert into tc_audit(shift_id,worker_id,action) values($1,$2,'clock_in')", [s.id, worker]);
  return s;
}

it("removes the shift and its parts, keeps prior audit plus a delete record", async () => {
  const s = await runaway();
  expect(await del({ id: s.id, version: s.version, reason: "Never clocked out; hours re-added" })).toEqual({ deleted: s.id });
  for (const t of ["tc_shifts where id", "tc_segments where shift_id", "tc_breaks where shift_id", "tc_tasks where shift_id"])
    expect(await count(`select count(*) n from ${t}=$1`, [s.id])).toBe(0);
  const audit = (await db.query("select action,actor_id,details from tc_audit where shift_id=$1 order by id", [s.id])).rows;
  expect(audit.map((a) => a.action)).toEqual(["clock_in", "delete_shift"]);
  expect(audit[1].actor_id).toBe(actor);
  expect(audit[1].details.reason).toBe("Never clocked out; hours re-added");
  expect(audit[1].details.before.segments[0].role_name).toBe("Bartender");
  // The audit log is still immutable.
  await expect(db.query("delete from tc_audit where shift_id=$1", [s.id])).rejects.toThrow(/audit_is_immutable/);
});

it("frees the time so correct hours can be added afterwards", async () => {
  const s = await runaway();
  const add = { worker_id: worker, role_id: "bartender", started_at: at(-100), ended_at: at(-92), reason: "Actual hours per door lead" };
  await expect(addHours(add)).rejects.toThrow(/shift_overlap/);
  await del({ id: s.id, version: s.version, reason: "Never clocked out" });
  expect((await addHours(add)).shift.status).toBe("pending");
});

it("deletes approved and manager-added shifts and cancels an open fix request", async () => {
  const { shift } = await addHours({ worker_id: worker, role_id: "bartender", started_at: at(-30), ended_at: at(-24), reason: "Entered on wrong day" });
  const approved = (await admin("approve", { id: shift.id, version: shift.version })).shift;
  const req = (await db.query(
    "insert into tc_change_requests(worker_id,kind,shift_id,requested_start,requested_end,reason) values($1,'edit_shift',$2,$3,$4,'Wrong time') returning id",
    [worker, shift.id, at(-29), at(-24)],
  )).rows[0];
  await del({ id: shift.id, version: approved.version, reason: "Entered on wrong day" });
  expect(await count("select count(*) n from tc_shifts where id=$1", [shift.id])).toBe(0);
  const r = (await db.query("select status,manager_note from tc_change_requests where id=$1", [req.id])).rows[0];
  expect(r).toEqual({ status: "cancelled", manager_note: "Shift deleted by a manager." });
});

it("deletes an open shift so the person is no longer clocked in", async () => {
  const s = (await db.query(
    "insert into tc_shifts(worker_id,kiosk_id,started_at,pay_basis) values($1,$2,$3,'hourly') returning id,version",
    [worker, kiosk, at(-3)],
  )).rows[0];
  await del({ id: s.id, version: s.version, reason: "Clocked in by mistake" });
  expect(await count("select count(*) n from tc_shifts where worker_id=$1 and ended_at is null", [worker])).toBe(0);
});

it("requires a reason, the current version and an existing shift", async () => {
  const s = await runaway();
  await expect(del({ id: s.id, version: s.version, reason: "no" })).rejects.toThrow(/reason_required/);
  await expect(del({ id: s.id, version: s.version + 1, reason: "Never clocked out" })).rejects.toThrow(/shift_changed/);
  await expect(del({ id: "22222222-2222-4222-8222-222222222222", version: 1, reason: "Never clocked out" })).rejects.toThrow(/shift_not_found/);
  await expect(call("tc_delete_shift", [null, JSON.stringify({ id: s.id, version: 1, reason: "Never clocked out" })])).rejects.toThrow(/not_authorized/);
  expect(await count("select count(*) n from tc_shifts where id=$1", [s.id])).toBe(1);
});

it("is callable only by the service role", async () => {
  const grants = (await db.query(
    "select grantee from information_schema.routine_privileges where routine_name='tc_delete_shift' and privilege_type='EXECUTE' order by grantee",
  )).rows.map((r) => r.grantee);
  expect(grants).not.toContain("anon");
  expect(grants).not.toContain("authenticated");
  expect(grants).toContain("service_role");
});
