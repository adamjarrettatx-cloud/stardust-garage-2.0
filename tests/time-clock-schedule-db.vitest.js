import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

let db, worker, other;
const actor = "11111111-1111-4111-8111-111111111111";
const employeeUser = "22222222-2222-4222-8222-222222222222";
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
const sched = (action, payload) =>
  call("tc_schedule_admin", [actor, action, JSON.stringify(payload)]);
const login = (action, payload) =>
  call("tc_login_admin", [actor, action, JSON.stringify(payload)]);
const view = (user = employeeUser) =>
  call("tc_employee_view", [
    user,
    new Date(Date.now() - 30 * 86400000).toISOString(),
    new Date(Date.now() + 86400000).toISOString(),
  ]);
const at = (hours) => new Date(Date.now() + hours * 3600000).toISOString();
const mig = (name) =>
  readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key, email text, raw_app_meta_data jsonb default '{}');
    insert into auth.users(id,email) values('${actor}','owner@example.test'),('${employeeUser}','Avery@Example.test');`);
  await db.exec(`
    grant usage on schema public to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant all on functions to anon,authenticated,service_role;
  `);
  await db.exec(mig("20260930031000_staff_time_clock.sql"));
  await db.exec(mig("20261002160000_staff_schedule_employee_portal.sql"));
}, 30000);

beforeEach(async () => {
  await db.exec("truncate tc_schedule,tc_workers,tc_kiosks,tc_limits cascade;");
  const mk = (name, lookup) =>
    admin("save_worker", {
      name,
      category: "employee",
      active: true,
      pay_basis: "hourly",
      flat_cents: null,
      pin_lookup: lookup.repeat(64),
      pin_verifier: "test-only-hash",
      roles: [
        { role_id: "bartender", rate_cents: 2200 },
        { role_id: "front_door", rate_cents: 2000 },
      ],
    });
  worker = (await mk("Avery", "a")).id;
  other = (await mk("Blake", "b")).id;
});

it("creates multi-person schedule entries in one atomic call", async () => {
  const result = await sched("create_schedule", {
    entries: [
      { worker_id: worker, role_id: "bartender", starts_at: at(2), ends_at: at(8) },
      { worker_id: other, role_id: "front_door", starts_at: at(2), ends_at: at(8) },
    ],
  });
  expect(result.count).toBe(2);
  const rows = (await db.query("select count(*)::int n from tc_schedule")).rows[0].n;
  expect(rows).toBe(2);
});

it("rejects overlaps, unassigned roles and invalid ranges without partial writes", async () => {
  await sched("create_schedule", {
    entries: [{ worker_id: worker, role_id: "bartender", starts_at: at(2), ends_at: at(8) }],
  });
  await expect(
    sched("create_schedule", {
      entries: [
        { worker_id: other, role_id: "bartender", starts_at: at(2), ends_at: at(8) },
        { worker_id: worker, role_id: "front_door", starts_at: at(6), ends_at: at(10) },
      ],
    }),
  ).rejects.toThrow("schedule_overlap");
  expect((await db.query("select count(*)::int n from tc_schedule")).rows[0].n).toBe(1);
  await expect(
    sched("create_schedule", {
      entries: [{ worker_id: other, role_id: "floor_support", starts_at: at(2), ends_at: at(3) }],
    }),
  ).rejects.toThrow("schedule_role_not_assigned");
  await expect(
    sched("create_schedule", {
      entries: [{ worker_id: other, role_id: "bartender", starts_at: at(5), ends_at: at(4) }],
    }),
  ).rejects.toThrow();
  await expect(
    sched("create_schedule", {
      entries: [{ worker_id: other, role_id: "bartender", starts_at: at(1), ends_at: at(30) }],
    }),
  ).rejects.toThrow();
});

it("updates with version checks and deletes with audit", async () => {
  const { ids } = await sched("create_schedule", {
    entries: [{ worker_id: worker, role_id: "bartender", starts_at: at(2), ends_at: at(8) }],
  });
  const id = ids[0];
  await sched("update_schedule", {
    id, version: 1, worker_id: other, role_id: "front_door", starts_at: at(3), ends_at: at(9), note: "Door",
  });
  await expect(
    sched("update_schedule", {
      id, version: 1, worker_id: other, role_id: "front_door", starts_at: at(3), ends_at: at(9),
    }),
  ).rejects.toThrow("schedule_changed");
  await sched("delete_schedule", { id });
  const audit = (
    await db.query("select action from tc_audit where action like 'schedule_%' order by id")
  ).rows.map((r) => r.action);
  expect(audit).toEqual(["schedule_create", "schedule_update", "schedule_delete"]);
});

it("employee view is personal, link-gated and includes pay rates and crew", async () => {
  expect(await view()).toBeNull();
  await login("link_login", { worker_id: worker, user_id: employeeUser, username: "avery", managed: true });
  await sched("create_schedule", {
    entries: [
      { worker_id: worker, role_id: "bartender", starts_at: at(2), ends_at: at(8) },
      { worker_id: other, role_id: "front_door", starts_at: at(4), ends_at: at(9) },
    ],
  });
  const v = await view();
  expect(v.worker.name).toBe("Avery");
  expect(v.roles.find((r) => r.id === "bartender").rate_cents).toBe(2200);
  expect(v.schedule).toHaveLength(1);
  expect(v.schedule[0].crew).toEqual([
    expect.objectContaining({ name: "Blake", role_name: "Front door" }),
  ]);
  expect(JSON.stringify(v)).not.toContain("pin_");
  expect(JSON.stringify(v.schedule[0].crew)).not.toContain("rate");
  await login("set_login_enabled", { worker_id: worker, enabled: false });
  expect(await view()).toBeNull();
  await login("set_login_enabled", { worker_id: worker, enabled: true });
  await admin("save_worker", {
    id: worker, name: "Avery", category: "employee", active: false, pay_basis: "hourly", flat_cents: null,
    roles: [{ role_id: "bartender", rate_cents: 2200 }],
  });
  expect(await view()).toBeNull();
  await expect(login("link_login", { worker_id: worker, user_id: randomUUID() })).rejects.toThrow();
});

it("one Auth user cannot link to two profiles and usernames are unique", async () => {
  await login("link_login", { worker_id: worker, user_id: employeeUser, username: "avery", managed: true });
  await expect(
    login("link_login", { worker_id: other, user_id: employeeUser, username: "blake" }),
  ).rejects.toThrow();
});

it("looks up existing accounts by email case-insensitively", async () => {
  const found = await call("tc_auth_user_by_email", ["avery@example.TEST"]);
  expect(found).toEqual({ id: employeeUser, station: false });
  expect(await call("tc_auth_user_by_email", ["nobody@example.test"])).toBeNull();
});

it("browser roles cannot read schedules or call RPCs", async () => {
  await db.exec("set role authenticated");
  try {
    await expect(db.query("select * from tc_schedule")).rejects.toThrow();
    await expect(
      db.query(`select public.tc_employee_view('${employeeUser}', now(), now())`),
    ).rejects.toThrow();
  } finally {
    await db.exec("reset role");
  }
});
