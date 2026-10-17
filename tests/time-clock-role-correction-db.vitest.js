import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

// Timesheet role correction (tc_correct_shift): fix the role a shift was
// clocked under, optionally with new times, in one audited transaction.
let db, worker, kiosk;
const actor = "11111111-1111-4111-8111-111111111111";
const mig = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const at = (hours) => new Date(Date.now() + hours * 3600000).toISOString();
async function call(name, values) {
  return (await db.query(`select public.${name}(${values.map((_, i) => `$${i + 1}`).join(",")}) as result`, values)).rows[0].result;
}
const admin = (action, payload) => call("tc_admin", [actor, action, JSON.stringify(payload)]);
const addHours = (payload) => call("tc_add_manual_shift", [actor, JSON.stringify(payload)]);
const correct = (payload) => call("tc_correct_shift", [actor, JSON.stringify(payload)]);
const REASON = "Clocked in as Bartender; worked Front Door";
const base = (extra = {}) => ({
  worker_id: worker, role_id: "bartender", started_at: at(-30), ended_at: at(-24),
  reason: "Forgot to clock in; confirmed with door lead", ...extra,
});

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
    "20261017150000_timesheet_role_correction.sql",
  ])
    await db.exec(mig(m));
}, 30000);

beforeEach(async () => {
  await db.exec("truncate tc_invites,tc_change_requests,tc_schedule,tc_workers,tc_kiosks,tc_limits cascade;");
  worker = (await admin("save_worker", {
    name: "Avery", category: "employee", active: true, pay_basis: "hourly", flat_cents: null,
    pin_lookup: "a".repeat(64), pin_verifier: "test-only-hash",
    roles: [{ role_id: "bartender", rate_cents: 2200 }, { role_id: "front_door", rate_cents: 2500 }],
  })).id;
  kiosk = (await admin("create_kiosk", { label: "Test", pairing_hash: "p".repeat(64) })).id;
});
const segs = async (id) =>
  (await db.query("select id,role_id,role_name,rate_cents from tc_segments where shift_id=$1 order by started_at", [id])).rows;

it("changes an approved shift's role, re-snapshots the rate, reopens review and audits before/after", async () => {
  const { shift } = await addHours(base());
  const approved = (await admin("approve", { id: shift.id, version: shift.version })).shift;
  const [g] = await segs(shift.id);
  const out = (await correct({ id: shift.id, version: approved.version, reason: REASON,
    segments: [{ id: g.id, role_id: "front_door" }] })).shift;
  expect(out.status).toBe("pending");
  expect(out.started_at).toBe(shift.started_at);
  expect(await segs(shift.id)).toEqual([{ id: g.id, role_id: "front_door", role_name: "Front door", rate_cents: 2500 }]);
  const audit = (await db.query("select action,details from tc_audit where shift_id=$1 and action='correct_role'", [shift.id])).rows;
  expect(audit).toHaveLength(1);
  expect(audit[0].details.reason).toBe(REASON);
  expect(audit[0].details.changes[0]).toMatchObject({ from_role: "bartender", from_rate_cents: 2200, to_role: "front_door", to_rate_cents: 2500 });
  expect(audit[0].details.before.segments[0].role_id).toBe("bartender");
  // Stale version is refused.
  await expect(correct({ id: shift.id, version: approved.version, reason: REASON,
    segments: [{ id: g.id, role_id: "bartender" }] })).rejects.toThrow(/shift_changed/);
});

it("uses a one-off rate for a role not on the profile without changing the profile", async () => {
  const { shift } = await addHours(base());
  const [g] = await segs(shift.id);
  await correct({ id: shift.id, version: shift.version, reason: REASON, segments: [{ id: g.id, role_id: "floor_support", rate_cents: 1800 }] });
  expect((await segs(shift.id))[0]).toMatchObject({ role_id: "floor_support", rate_cents: 1800 });
  const roles = (await db.query("select role_id from tc_assignments where worker_id=$1 order by role_id", [worker])).rows;
  expect(roles).toEqual([{ role_id: "bartender" }, { role_id: "front_door" }]);
});

it("corrects times and role together in one save", async () => {
  const { shift } = await addHours(base());
  const [g] = await segs(shift.id);
  const out = (await correct({ id: shift.id, version: shift.version, reason: REASON,
    started_at: at(-29), ended_at: at(-25), segments: [{ id: g.id, role_id: "front_door" }] })).shift;
  expect(Math.abs(Date.parse(out.started_at) - (Date.now() - 29 * 3600000))).toBeLessThan(60000);
  expect(out.segments[0].role_id).toBe("front_door");
  const actions = (await db.query("select action from tc_audit where shift_id=$1 order by id", [shift.id])).rows.map((r) => r.action);
  expect(actions).toEqual(["manual_shift", "correct", "correct_role"]);
});

it("fixes only the wrong part of a shift with a mid-shift role switch", async () => {
  const sh = (await db.query(
    "insert into tc_shifts(worker_id,kiosk_id,started_at,ended_at,pay_basis,status) values($1,$2,$3,$4,'hourly','pending') returning id,version",
    [worker, kiosk, at(-30), at(-24)])).rows[0];
  await db.query("insert into tc_segments(shift_id,role_id,role_name,rate_cents,started_at,ended_at) values($1,'bartender','Bartender',2200,$2,$3),($1,'floor_support','Floor support',null,$3,$4)",
    [sh.id, at(-30), at(-27), at(-24)]);
  const [, second] = await segs(sh.id);
  await correct({ id: sh.id, version: sh.version, reason: REASON, segments: [{ id: second.id, role_id: "front_door" }] });
  expect((await segs(sh.id)).map((g) => [g.role_id, g.rate_cents])).toEqual([["bartender", 2200], ["front_door", 2500]]);
});

it("keeps a running shift open and swaps its untouched iPad duties", async () => {
  const sh = (await db.query(
    "insert into tc_shifts(worker_id,kiosk_id,started_at,pay_basis) values($1,$2,$3,'hourly') returning id,version",
    [worker, kiosk, at(-2)])).rows[0];
  await db.query("insert into tc_segments(shift_id,role_id,role_name,rate_cents,started_at) values($1,'bartender','Bartender',2200,$2)", [sh.id, at(-2)]);
  await db.query("insert into tc_tasks(shift_id,role_id,title,done) values($1,'bartender','Check bar stock and ice',true),($1,'bartender','Complete closing inventory',false)", [sh.id]);
  const [g] = await segs(sh.id);
  const out = (await correct({ id: sh.id, version: sh.version, reason: REASON, segments: [{ id: g.id, role_id: "front_door" }] })).shift;
  expect(out.status).toBe("open");
  expect(out.ended_at).toBeNull();
  const tasks = out.tasks.map((t) => `${t.role_id}:${t.title}:${t.done}`).sort();
  expect(tasks).toEqual([
    "bartender:Check bar stock and ice:true",
    "front_door:Check entry station and scanner:false",
    "front_door:Follow guest entry procedures:false",
    "front_door:Leave a shift handoff:false",
  ]);
});

it("refuses no-op, foreign segments, inactive roles, short reasons, and browser roles", async () => {
  const { shift } = await addHours(base());
  const other = (await addHours(base({ started_at: at(-60), ended_at: at(-55) }))).shift;
  const [g] = await segs(shift.id);
  const [og] = await segs(other.id);
  await expect(correct({ id: shift.id, version: shift.version, reason: REASON, segments: [{ id: g.id, role_id: "bartender" }] })).rejects.toThrow(/no_role_change/);
  await expect(correct({ id: shift.id, version: shift.version, reason: REASON, segments: [{ id: og.id, role_id: "front_door" }] })).rejects.toThrow(/invalid_segments/);
  await expect(correct({ id: shift.id, version: shift.version, reason: "no", segments: [{ id: g.id, role_id: "front_door" }] })).rejects.toThrow(/reason_required/);
  await db.query("update tc_roles set active=false where id='floor_support'");
  await expect(correct({ id: shift.id, version: shift.version, reason: REASON, segments: [{ id: g.id, role_id: "floor_support" }] })).rejects.toThrow(/role_not_found/);
  await db.query("update tc_roles set active=true where id='floor_support'");
  expect((await segs(shift.id))[0].role_id).toBe("bartender");
  const grants = (await db.query(
    "select grantee from information_schema.routine_privileges where routine_name='tc_correct_shift' and privilege_type='EXECUTE'",
  )).rows.map((r) => r.grantee);
  expect(grants).not.toContain("anon");
  expect(grants).not.toContain("authenticated");
  expect(grants).toContain("service_role");
});
