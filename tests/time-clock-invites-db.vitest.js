import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

let db, worker, other;
const actor = "11111111-1111-4111-8111-111111111111";
const newUser = "22222222-2222-4222-8222-222222222222";
const otherUser = "44444444-4444-4444-8444-444444444444";
const photo = (w) => `staff/${w}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`;
async function call(name, values = []) {
  return (
    await db.query(`select public.${name}(${values.map((_, i) => `$${i + 1}`).join(",")}) as result`, values)
  ).rows[0].result;
}
const fails = async (promise, message) => expect(promise).rejects.toThrow(message);
const admin = (action, payload) => call("tc_admin", [actor, action, JSON.stringify(payload)]);
const invite = (action, payload) => call("tc_invite_admin", [actor, action, JSON.stringify(payload)]);
const peek = (hash) => call("tc_invite_peek", [hash]);
const redeem = (hash, payload) => call("tc_invite_redeem", [hash, JSON.stringify(payload)]);
const profile = (user, action, payload) => call("tc_employee_profile", [user, action, JSON.stringify(payload)]);
const login = (action, payload) => call("tc_login_admin", [actor, action, JSON.stringify(payload)]);
const mig = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const row = async (sql, values = []) => (await db.query(sql, values)).rows[0];
const setup = (w, extra = {}) => ({
  user_id: newUser, username: "avery", managed: true,
  pin_lookup: "9".repeat(64), pin_verifier: "scrypt-v1:test",
  birthdate: "1995-04-02", photo_path: photo(w), ...extra,
});

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key, email text, raw_app_meta_data jsonb default '{}');
    create table public.team_members(user_id uuid, role text); create table public.partner_profiles(user_id uuid, is_active boolean);
    insert into auth.users(id,email) values('${actor}','owner@example.test'),('${newUser}','avery@example.test'),('${otherUser}','blake@example.test');`);
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
  ])
    await db.exec(mig(m));
}, 30000);

beforeEach(async () => {
  await db.exec("truncate tc_invites,tc_change_requests,tc_schedule,tc_workers,tc_kiosks,tc_limits cascade;");
  // A new profile with no PIN yet, and a coworker who already has PIN "b".
  worker = (await admin("save_worker", {
    name: "Avery Stone", category: "employee", active: true, pay_basis: "hourly", flat_cents: null,
    pin_lookup: null, pin_verifier: null, roles: [{ role_id: "bartender", rate_cents: 2200 }],
  })).id;
  other = (await admin("save_worker", {
    name: "Blake", category: "employee", active: true, pay_basis: "unset", flat_cents: null,
    pin_lookup: "b".repeat(64), pin_verifier: "test-only", roles: [],
  })).id;
});

it("allows a profile without a PIN and keeps PIN columns paired", async () => {
  expect((await row("select pin_lookup from tc_workers where id=$1", [worker])).pin_lookup).toBeNull();
  await fails(db.query("update tc_workers set pin_lookup=$1 where id=$2", ["c".repeat(64), worker]), "tc_workers_pin_pair");
});

it("sends, peeks and redeems a setup invite exactly once", async () => {
  const sent = await invite("create", { worker_id: worker, email: " Avery@Example.test ", token_hash: "t".repeat(64) });
  expect(sent.email).toBe("avery@example.test");
  expect(Date.parse(sent.expires_at) - Date.now()).toBeGreaterThan(71.9 * 3600000);
  const p = await peek("t".repeat(64));
  expect(p).toMatchObject({ kind: "setup", name: "Avery Stone", email: "avery@example.test", roles: ["Bartender"] });
  const r = await redeem("t".repeat(64), setup(worker));
  expect(r).toMatchObject({ user_id: newUser, username: "avery", managed: true });
  const w = await row("select * from tc_workers where id=$1", [worker]);
  expect(w).toMatchObject({ user_id: newUser, login_enabled: true, login_managed: true, pin_lookup: "9".repeat(64), photo_path: photo(worker) });
  expect(w.birthdate).toBeTruthy();
  expect(w.pin_set_by_employee_at).toBeTruthy();
  expect(await peek("t".repeat(64))).toBeNull();
  await fails(redeem("t".repeat(64), setup(worker)), "invite_invalid");
  const audit = await row("select count(*)::int n from tc_audit where worker_id=$1 and action like 'invite_setup_%'", [worker]);
  expect(audit.n).toBe(2);
});

it("replaces an earlier open invite when a new one is sent and supports cancel", async () => {
  await invite("create", { worker_id: worker, email: "a@example.test", token_hash: "1".repeat(64) });
  await invite("create", { worker_id: worker, email: "b@example.test", token_hash: "2".repeat(64) });
  expect(await peek("1".repeat(64))).toBeNull();
  expect((await peek("2".repeat(64))).email).toBe("b@example.test");
  await invite("revoke", { worker_id: worker });
  expect(await peek("2".repeat(64))).toBeNull();
  await fails(invite("revoke", { worker_id: worker }), "invite_not_found");
});

it("rejects expired links, over-attempted links and inactive profiles", async () => {
  await invite("create", { worker_id: worker, email: "a@example.test", token_hash: "e".repeat(64) });
  await db.query("update tc_invites set expires_at=now()-interval '1 minute'");
  expect(await peek("e".repeat(64))).toBeNull();
  await fails(redeem("e".repeat(64), setup(worker)), "invite_invalid");

  await invite("create", { worker_id: worker, email: "a@example.test", token_hash: "f".repeat(64) });
  for (let i = 0; i < 20; i++) await call("tc_invite_attempt", ["f".repeat(64)]);
  expect(await peek("f".repeat(64))).toBeNull();

  await invite("create", { worker_id: worker, email: "a@example.test", token_hash: "g".repeat(64) });
  await admin("save_worker", { id: worker, name: "Avery Stone", category: "employee", active: false, pay_basis: "hourly", flat_cents: null, roles: [] });
  expect(await peek("g".repeat(64))).toBeNull();
  await fails(invite("create", { worker_id: worker, email: "a@example.test", token_hash: "h".repeat(64) }), "schedule_worker_inactive");
});

it("will not reuse a coworker's PIN, a taken username or an already-linked account", async () => {
  await invite("create", { worker_id: worker, email: "a@example.test", token_hash: "t".repeat(64) });
  await fails(redeem("t".repeat(64), setup(worker, { pin_lookup: "b".repeat(64) })), "pin_taken");
  await login("link_login", { worker_id: other, user_id: otherUser, username: "blake", managed: true });
  await fails(redeem("t".repeat(64), setup(worker, { username: "blake" })), "username_taken");
  await fails(redeem("t".repeat(64), setup(worker, { user_id: otherUser })), "account_linked");
  await fails(redeem("t".repeat(64), setup(worker, { photo_path: null })), "profile_incomplete");
  await fails(redeem("t".repeat(64), setup(worker, { birthdate: "2999-01-01" })), "profile_incomplete");
  // Failed attempts leave the invite usable and the profile untouched.
  expect(await peek("t".repeat(64))).not.toBeNull();
  expect((await row("select user_id from tc_workers where id=$1", [worker])).user_id).toBeNull();
  await redeem("t".repeat(64), setup(worker));
});

it("refuses a setup invite for a profile that already has a login", async () => {
  await login("link_login", { worker_id: other, user_id: otherUser, username: "blake", managed: true });
  await fails(invite("create", { worker_id: other, email: "b@example.test", token_hash: "t".repeat(64) }), "login_exists");
});

it("PIN reset links set a new PIN, rotate the PIN session and keep the old PIN until used", async () => {
  await login("link_login", { worker_id: other, user_id: otherUser, username: "blake", managed: true });
  await fails(invite("create", { worker_id: worker, kind: "pin", email: "a@example.test", token_hash: "p".repeat(64) }), "login_missing");
  await invite("create", { worker_id: other, kind: "pin", email: "blake@example.test", token_hash: "p".repeat(64) });
  const before = await row("select pin_lookup,credential_version from tc_workers where id=$1", [other]);
  expect(before.pin_lookup).toBe("b".repeat(64));
  await fails(redeem("p".repeat(64), { pin_lookup: "b".repeat(64), pin_verifier: "x" }), "pin_unchanged");
  await redeem("p".repeat(64), { pin_lookup: "8".repeat(64), pin_verifier: "x" });
  const after = await row("select pin_lookup,credential_version from tc_workers where id=$1", [other]);
  expect(after.pin_lookup).toBe("8".repeat(64));
  expect(after.credential_version).not.toBe(before.credential_version);
  expect(await peek("p".repeat(64))).toBeNull();
});

it("lets a signed-in employee complete their own profile and change their own PIN only", async () => {
  await login("link_login", { worker_id: other, user_id: otherUser, username: "blake", managed: true });
  await fails(profile(otherUser, "complete", { birthdate: "1990-01-01" }), "profile_incomplete");
  const r = await profile(otherUser, "complete", { birthdate: "1990-01-01", photo_path: photo(other) });
  expect(r.replaced_photo).toBeNull();
  const replaced = await profile(otherUser, "complete", { photo_path: `staff/${other}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png` });
  expect(replaced.replaced_photo).toBe(photo(other));
  await fails(profile(otherUser, "set_pin", { pin_lookup: "b".repeat(64), pin_verifier: "x" }), "pin_unchanged");
  await fails(profile(newUser, "complete", { birthdate: "1990-01-01", photo_path: photo(worker) }), "not_employee");
  await profile(otherUser, "set_pin", { pin_lookup: "7".repeat(64), pin_verifier: "x" });
  expect((await row("select pin_lookup from tc_workers where id=$1", [other])).pin_lookup).toBe("7".repeat(64));
  // Another worker's PIN is refused.
  await admin("reset_pin", { id: worker, pin_lookup: "6".repeat(64), pin_verifier: "x" });
  await fails(profile(otherUser, "set_pin", { pin_lookup: "6".repeat(64), pin_verifier: "x" }), "pin_taken");
});

it("rejects photo paths outside the staff prefix", async () => {
  await login("link_login", { worker_id: other, user_id: otherUser, username: "blake", managed: true });
  await fails(profile(otherUser, "complete", { birthdate: "1990-01-01", photo_path: `${otherUser}/photo.jpg` }), "check");
});

it("grants the new functions and invite table to service_role only", async () => {
  for (const role of ["anon", "authenticated"]) {
    const r = await row(
      `select has_function_privilege('${role}', 'public.tc_invite_redeem(text,jsonb)', 'execute') f,
              has_table_privilege('${role}', 'public.tc_invites', 'select') t`,
    );
    expect(r).toEqual({ f: false, t: false });
  }
  const s = await row(`select has_function_privilege('service_role', 'public.tc_invite_peek(text)', 'execute') f`);
  expect(s.f).toBe(true);
});

it("lets a manager correct a birthday, audits it, and keeps it service-role only", async () => {
  const set = (d) => call("tc_worker_birthdate", [actor, worker, d]);
  expect(await set("1994-07-09")).toMatchObject({ changed: true });
  expect(await set("1994-07-09")).toMatchObject({ changed: false });
  expect(String((await row("select birthdate::text b from tc_workers where id=$1", [worker])).b)).toBe("1994-07-09");
  await fails(set("2999-01-01"), "profile_incomplete");
  await fails(call("tc_worker_birthdate", [null, worker, "1994-07-09"]), "not_authorized");
  const audit = await row("select count(*)::int n from tc_audit where worker_id=$1 and action='birthdate_set'", [worker]);
  expect(audit.n).toBe(1);
  for (const role of ["anon", "authenticated"]) {
    const r = await row(`select has_function_privilege('${role}', 'public.tc_worker_birthdate(uuid,uuid,date)', 'execute') f`);
    expect(r.f).toBe(false);
  }
});
