import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

// Manager "Add hours" (tc_add_manual_shift): hours for someone who did not
// clock in, including a brand-new no-PIN profile created from Timesheets.
let db, worker, quick, kiosk;
const actor = "11111111-1111-4111-8111-111111111111";
const mig = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const at = (hours) => new Date(Date.now() + hours * 3600000).toISOString();
async function call(name, values) {
  return (await db.query(`select public.${name}(${values.map((_, i) => `$${i + 1}`).join(",")}) as result`, values)).rows[0].result;
}
const admin = (action, payload) => call("tc_admin", [actor, action, JSON.stringify(payload)]);
const addHours = (payload) => call("tc_add_manual_shift", [actor, JSON.stringify(payload)]);
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
  // What the quick-add form creates: contractor, no PIN, one role + rate.
  quick = (await admin("save_worker", {
    name: "Casey New", category: "contractor", active: true, pay_basis: "hourly", flat_cents: null,
    pin_lookup: null, pin_verifier: null, roles: [{ role_id: "front_door", rate_cents: 2500 }],
  })).id;
  kiosk = (await admin("create_kiosk", { label: "Test", pairing_hash: "p".repeat(64) })).id;
});

it("creates a Needs review manager shift with the assigned rate and an audit entry", async () => {
  const { shift } = await addHours(base());
  expect(shift.status).toBe("pending");
  expect((await db.query("select source from tc_shifts where id=$1", [shift.id])).rows[0].source).toBe("manager");
  const seg = (await db.query("select role_id,rate_cents from tc_segments where shift_id=$1", [shift.id])).rows;
  expect(seg).toEqual([{ role_id: "bartender", rate_cents: 2200 }]);
  const audit = (await db.query("select action,details->>'reason' reason from tc_audit where shift_id=$1", [shift.id])).rows;
  expect(audit).toEqual([{ action: "manual_shift", reason: "Forgot to clock in; confirmed with door lead" }]);
  // Normal approval path still works.
  const approved = await admin("approve", { id: shift.id, version: shift.version });
  expect(approved.shift.status).toBe("approved");
});

it("works for a brand-new profile with no PIN", async () => {
  const { shift } = await addHours(base({ worker_id: quick, role_id: "front_door" }));
  const seg = (await db.query("select rate_cents from tc_segments where shift_id=$1", [shift.id])).rows[0];
  expect(seg.rate_cents).toBe(2500);
});

it("uses a one-off rate for an unassigned role without changing the profile", async () => {
  const { shift } = await addHours(base({ role_id: "front_door", rate_cents: 1900 }));
  expect((await db.query("select rate_cents from tc_segments where shift_id=$1", [shift.id])).rows[0].rate_cents).toBe(1900);
  const roles = (await db.query("select role_id from tc_assignments where worker_id=$1", [worker])).rows;
  expect(roles).toEqual([{ role_id: "bartender" }]);
  // The assigned rate always wins over a one-off rate.
  const second = await addHours(base({ started_at: at(-60), ended_at: at(-55), rate_cents: 1 }));
  expect((await db.query("select rate_cents from tc_segments where shift_id=$1", [second.shift.id])).rows[0].rate_cents).toBe(2200);
});

it("blocks overlaps with existing punches, future times, long shifts, missing reasons and dismissed staff", async () => {
  await db.query(
    "insert into tc_shifts(worker_id,kiosk_id,started_at,ended_at,pay_basis,status) values($1,$2,$3,$4,'hourly','pending')",
    [worker, kiosk, at(-28), at(-26)],
  );
  await expect(addHours(base())).rejects.toThrow(/shift_overlap/);
  await expect(addHours(base({ started_at: at(-2), ended_at: at(1) }))).rejects.toThrow(/invalid_time_range/);
  await expect(addHours(base({ started_at: at(-60), ended_at: at(-35) }))).rejects.toThrow(/invalid_time_range/);
  await expect(addHours(base({ started_at: at(-50), ended_at: at(-48), reason: "no" }))).rejects.toThrow(/reason_required/);
  await expect(addHours(base({ started_at: at(-50), ended_at: at(-48), role_id: "nope_role" }))).rejects.toThrow(/role_not_found/);
  await admin("save_worker", {
    id: quick, name: "Casey New", category: "contractor", active: false, pay_basis: "hourly", flat_cents: null,
    roles: [{ role_id: "front_door", rate_cents: 2500 }],
  });
  await expect(addHours(base({ worker_id: quick, role_id: "front_door" }))).rejects.toThrow(/schedule_worker_inactive/);
});

it("is not callable from the browser roles", async () => {
  const grants = (await db.query(
    "select grantee from information_schema.routine_privileges where routine_name='tc_add_manual_shift' and privilege_type='EXECUTE'",
  )).rows.map((r) => r.grantee);
  expect(grants).not.toContain("anon");
  expect(grants).not.toContain("authenticated");
  expect(grants).toContain("service_role");
});
