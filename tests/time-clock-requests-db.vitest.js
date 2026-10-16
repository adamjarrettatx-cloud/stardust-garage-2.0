import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

let db, worker, other, kiosk;
const actor = "11111111-1111-4111-8111-111111111111";
const employeeUser = "22222222-2222-4222-8222-222222222222";
const otherUser = "44444444-4444-4444-8444-444444444444";
async function call(name, values = []) {
  return (
    await db.query(
      `select public.${name}(${values.map((_, i) => `$${i + 1}`).join(",")}) as result`,
      values,
    )
  ).rows[0].result;
}
const admin = (action, payload) => call("tc_admin", [actor, action, JSON.stringify(payload)]);
const sched = (action, payload) => call("tc_schedule_admin", [actor, action, JSON.stringify(payload)]);
const login = (action, payload) => call("tc_login_admin", [actor, action, JSON.stringify(payload)]);
const ask = (payload, user = employeeUser, action = "create") =>
  call("tc_employee_request", [user, action, JSON.stringify(payload)]);
const decide = (action, payload) => call("tc_request_admin", [actor, action, JSON.stringify(payload)]);
const view = (user = employeeUser) =>
  call("tc_employee_view", [
    user,
    new Date(Date.now() - 30 * 86400000).toISOString(),
    new Date(Date.now() + 86400000).toISOString(),
  ]);
const at = (hours) => new Date(Date.now() + hours * 3600000).toISOString();
const mig = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const row = async (sql, values = []) => (await db.query(sql, values)).rows[0];

async function closedShift(workerId, startH, endH, status = "pending") {
  const s = at(startH), e = at(endH);
  const shift = await row(
    "insert into tc_shifts(worker_id,kiosk_id,started_at,ended_at,pay_basis,status) values($1,$2,$3,$4,'hourly',$5) returning id,version",
    [workerId, kiosk, s, e, status],
  );
  await db.query(
    "insert into tc_segments(shift_id,role_id,role_name,rate_cents,started_at,ended_at) values($1,'bartender','Bartender',2200,$2,$3)",
    [shift.id, s, e],
  );
  return shift;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key, email text, raw_app_meta_data jsonb default '{}');
    create table public.team_members(user_id uuid, role text); create table public.partner_profiles(user_id uuid, is_active boolean);
    insert into auth.users(id,email) values('${actor}','owner@example.test'),('${employeeUser}','avery@example.test'),('${otherUser}','blake@example.test');`);
  await db.exec(`
    grant usage on schema public to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant all on functions to anon,authenticated,service_role;
  `);
  await db.exec(mig("20260930031000_staff_time_clock.sql"));
  await db.exec(mig("20261002160000_staff_schedule_employee_portal.sql"));
  await db.exec(mig("20261011200000_employee_hub_requests.sql"));
  await db.exec(mig("20261012150000_employee_view_preview.sql"));
}, 30000);

beforeEach(async () => {
  await db.exec("truncate tc_change_requests,tc_schedule,tc_workers,tc_kiosks,tc_limits cascade;");
  const mk = (name, lookup) =>
    admin("save_worker", {
      name, category: "employee", active: true, pay_basis: "hourly", flat_cents: null,
      pin_lookup: lookup.repeat(64), pin_verifier: "test-only-hash",
      roles: [{ role_id: "bartender", rate_cents: 2200 }, { role_id: "front_door", rate_cents: 2000 }],
    });
  worker = (await mk("Avery", "a")).id;
  other = (await mk("Blake", "b")).id;
  await login("link_login", { worker_id: worker, user_id: employeeUser, username: "avery", managed: true });
  await login("link_login", { worker_id: other, user_id: otherUser, username: "blake", managed: true });
  kiosk = (await admin("create_kiosk", { label: "Test", pairing_hash: "p".repeat(64) })).id;
});

it("an approved hour fix goes through the audited correction and approves the shift", async () => {
  const shift = await closedShift(worker, -30, -24);
  const req = await ask({ kind: "edit_shift", shift_id: shift.id, starts_at: at(-30.5), ends_at: at(-24), reason: "Forgot to clock in at 6" });
  expect(req.status).toBe("pending");
  const pending = await call("tc_requests_view", ["pending", 50]);
  expect(pending).toHaveLength(1);
  expect(pending[0].worker_name).toBe("Avery");
  const done = await decide("approve", { id: req.id, version: 1 });
  expect(done.status).toBe("approved");
  const s = await row("select started_at,status from tc_shifts where id=$1", [shift.id]);
  expect(Math.abs(new Date(s.started_at).getTime() - Date.parse(at(-30.5)))).toBeLessThan(5000);
  expect(s.status).toBe("approved");
  const audit = (await db.query("select action from tc_audit where shift_id=$1 order by id", [shift.id])).rows.map((r) => r.action);
  expect(audit).toEqual(expect.arrayContaining(["request_create", "correct", "approve", "request_approve"]));
  const correction = await row("select details from tc_audit where shift_id=$1 and action='correct'", [shift.id]);
  expect(correction.details.before.started_at).toBeTruthy();
  expect(correction.details.reason).toMatch(/^Employee request: /);
});

it("employees can only fix their own closed shifts, once at a time, with real changes", async () => {
  const mine = await closedShift(worker, -30, -24);
  const theirs = await closedShift(other, -30, -24);
  await expect(ask({ kind: "edit_shift", shift_id: theirs.id, starts_at: at(-31), ends_at: at(-24), reason: "Not mine" })).rejects.toThrow("shift_not_found");
  await expect(ask({ kind: "edit_shift", shift_id: mine.id, starts_at: at(-31), ends_at: at(2), reason: "Future end" })).rejects.toThrow("request_invalid_time");
  await expect(ask({ kind: "edit_shift", shift_id: mine.id, starts_at: at(-31), ends_at: at(-24), reason: "x" })).rejects.toThrow("request_reason_required");
  await ask({ kind: "edit_shift", shift_id: mine.id, starts_at: at(-31), ends_at: at(-24), reason: "Clocked in late" });
  await expect(ask({ kind: "edit_shift", shift_id: mine.id, starts_at: at(-32), ends_at: at(-24), reason: "Again" })).rejects.toThrow("request_duplicate");
  const open = await row(
    "insert into tc_shifts(worker_id,kiosk_id,started_at,pay_basis) values($1,$2,$3,'hourly') returning id",
    [worker, kiosk, at(-1)],
  );
  await expect(ask({ kind: "edit_shift", shift_id: open.id, starts_at: at(-2), ends_at: at(-1), reason: "Still on" })).rejects.toThrow("request_shift_open");
});

it("an approved missed shift creates a manager-entered shift with the current rate", async () => {
  await closedShift(worker, -50, -44);
  await expect(ask({ kind: "missed_shift", role_id: "bartender", starts_at: at(-49), ends_at: at(-45), reason: "Overlaps" })).rejects.toThrow("shift_overlap");
  await expect(ask({ kind: "missed_shift", role_id: "floor_support", starts_at: at(-30), ends_at: at(-25), reason: "Not my role" })).rejects.toThrow("role_not_assigned");
  const req = await ask({ kind: "missed_shift", role_id: "front_door", starts_at: at(-30), ends_at: at(-25), reason: "iPad was offline" });
  const done = await decide("approve", { id: req.id, version: 1, note: "Confirmed with Jeyu" });
  const created = await row("select * from tc_shifts where source='manager'");
  expect(created.kiosk_id).toBeNull();
  expect(created.status).toBe("approved");
  const seg = await row("select role_id,rate_cents from tc_segments where shift_id=$1", [created.id]);
  expect(seg).toEqual({ role_id: "front_door", rate_cents: 2000 });
  expect(done.status).toBe("approved");
  const v = await view();
  expect(v.shifts.find((s) => s.id === created.id).source).toBe("manager");
  expect(v.requests[0].manager_note).toBe("Confirmed with Jeyu");
});

it("approved time off blocks scheduling until a manager revokes it", async () => {
  const req = await ask({ kind: "time_off", starts_at: at(48), ends_at: at(72), reason: "Family trip" });
  await expect(ask({ kind: "time_off", starts_at: at(50), ends_at: at(60), reason: "Overlap" })).rejects.toThrow("request_duplicate");
  const approved = await decide("approve", { id: req.id, version: 1 });
  expect(approved.schedule_conflicts).toEqual([]);
  await expect(
    sched("create_schedule", { entries: [{ worker_id: worker, role_id: "bartender", starts_at: at(50), ends_at: at(56) }] }),
  ).rejects.toThrow("schedule_time_off");
  await expect(decide("revoke_time_off", { id: req.id, version: approved.version })).rejects.toThrow("request_note_required");
  await decide("revoke_time_off", { id: req.id, version: approved.version, note: "Agreed to cover" });
  const ok = await sched("create_schedule", { entries: [{ worker_id: worker, role_id: "bartender", starts_at: at(50), ends_at: at(56) }] });
  expect(ok.count).toBe(1);
});

it("approving time off reports existing scheduled shifts it overlaps", async () => {
  await sched("create_schedule", { entries: [{ worker_id: worker, role_id: "bartender", starts_at: at(50), ends_at: at(56) }] });
  const req = await ask({ kind: "time_off", starts_at: at(48), ends_at: at(72), reason: "Sick" });
  const approved = await decide("approve", { id: req.id, version: 1 });
  expect(approved.schedule_conflicts).toHaveLength(1);
});

it("denials need a note, decisions are final, and stale versions are rejected", async () => {
  const req = await ask({ kind: "time_off", starts_at: at(48), ends_at: at(72), reason: "Trip" });
  await expect(decide("deny", { id: req.id, version: 1 })).rejects.toThrow("request_note_required");
  await expect(decide("approve", { id: req.id, version: 9 })).rejects.toThrow("request_changed");
  await decide("deny", { id: req.id, version: 1, note: "Short staffed that night" });
  await expect(decide("approve", { id: req.id, version: 2 })).rejects.toThrow("request_not_pending");
  await expect(ask({ id: req.id }, employeeUser, "cancel")).rejects.toThrow("request_not_pending");
});

it("only the owner of a pending request can cancel it", async () => {
  const req = await ask({ kind: "time_off", starts_at: at(48), ends_at: at(72), reason: "Trip" });
  await expect(ask({ id: req.id }, otherUser, "cancel")).rejects.toThrow("request_not_pending");
  const cancelled = await ask({ id: req.id }, employeeUser, "cancel");
  expect(cancelled.status).toBe("cancelled");
});

it("disabled or unlinked logins cannot send requests", async () => {
  await login("set_login_enabled", { worker_id: worker, enabled: false });
  await expect(ask({ kind: "time_off", starts_at: at(48), ends_at: at(72), reason: "Trip" })).rejects.toThrow("not_employee");
  await expect(ask({ kind: "time_off", starts_at: at(48), ends_at: at(72), reason: "Trip" }, "55555555-5555-4555-8555-555555555555")).rejects.toThrow("not_employee");
});

it("browser roles have no access to request tables or functions", async () => {
  for (const role of ["anon", "authenticated"]) {
    const grants = await row(
      `select has_table_privilege('${role}','public.tc_change_requests','select') t,
        has_function_privilege('${role}','public.tc_employee_request(uuid,text,jsonb)','execute') e,
        has_function_privilege('${role}','public.tc_request_admin(uuid,text,jsonb)','execute') a,
        has_function_privilege('${role}','public.tc_requests_view(text,integer)','execute') v`,
    );
    expect(grants).toEqual({ t: false, e: false, a: false, v: false });
  }
});

it("linking lookup reports team and partner identities", async () => {
  await db.query("insert into team_members(user_id,role) values($1,'team')", [otherUser]);
  expect((await call("tc_auth_user_by_email", ["BLAKE@example.test"])).team).toBe(true);
  expect((await call("tc_auth_user_by_email", ["avery@example.test"])).team).toBe(false);
  expect(await call("tc_auth_user_by_email", ["nobody@example.test"])).toBeNull();
});

const preview = (id) =>
  call("tc_employee_preview", [
    id,
    new Date(Date.now() - 30 * 86400000).toISOString(),
    new Date(Date.now() + 86400000).toISOString(),
  ]);

it("manager preview returns exactly the employee's own view, with or without a login", async () => {
  await closedShift(worker, -30, -24);
  await ask({ kind: "time_off", starts_at: at(48), ends_at: at(72), reason: "Trip" });
  const own = await view();
  const shown = await preview(worker);
  const strip = ({ server_now, preview: _p, ...rest }) => rest;
  expect(strip(shown)).toEqual(strip(own));
  expect(shown.preview.has_login).toBe(true);
  expect(shown.shifts).toHaveLength(1);
  expect(shown.requests).toHaveLength(1);
  await login("set_login_enabled", { worker_id: worker, enabled: false });
  expect(await view()).toBeNull();
  const noLogin = await preview(worker);
  expect(noLogin.worker.name).toBe("Avery");
  expect(noLogin.preview.has_login).toBe(false);
});

it("manager preview hides inactive profiles and is server-only", async () => {
  await db.query("update tc_workers set active=false where id=$1", [other]);
  expect(await preview(other)).toBeNull();
  expect(await preview("66666666-6666-4666-8666-666666666666")).toBeNull();
  for (const role of ["anon", "authenticated", "service_role"]) {
    const g = await row(
      `select has_function_privilege('${role}','public.tc_employee_preview(uuid,timestamptz,timestamptz)','execute') p,
        has_function_privilege('${role}','public.tc_employee_payload(uuid,timestamptz,timestamptz)','execute') b`,
    );
    expect(g).toEqual({ p: role === "service_role", b: false });
  }
});
