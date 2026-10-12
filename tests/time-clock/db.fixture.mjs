// Local-only QA adapter. Never imported by production files.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { hashPin, keyedHash } from "../../lib/time-clock/crypto.mjs";
export const testDb = new PGlite();
export const ownerId = "11111111-1111-4111-8111-111111111111";
export const employeeId = "33333333-3333-4333-8333-333333333333";
const ident = (name) => {
  if (!/^[a-z_]+$/.test(name)) throw new Error("Invalid SQL identifier");
  return `"${name}"`;
};
export async function initialize() {
  await testDb.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key, email text, raw_app_meta_data jsonb default '{}', banned boolean default false);
    create table public.team_members(user_id uuid, role text); create table public.partner_profiles(user_id uuid, is_active boolean);
    insert into auth.users(id,email) values('${ownerId}','adam@sdgatx.com'),('${employeeId}','jordan@example.test');`);
  await testDb.exec(
    readFileSync(
      new URL(
        "../../supabase/migrations/20260930031000_staff_time_clock.sql",
        "file://" + process.cwd() + "/tests/time-clock/",
      ),
      "utf8",
    ),
  );
  await testDb.exec(
    readFileSync(
      new URL(
        "../../supabase/migrations/20261002160000_staff_schedule_employee_portal.sql",
        "file://" + process.cwd() + "/tests/time-clock/",
      ),
      "utf8",
    ),
  );
  await testDb.exec(
    readFileSync(
      new URL(
        "../../supabase/migrations/20261011200000_employee_hub_requests.sql",
        "file://" + process.cwd() + "/tests/time-clock/",
      ),
      "utf8",
    ),
  );
  await testDb.exec(
    readFileSync(
      new URL(
        "../../supabase/migrations/20261012150000_employee_view_preview.sql",
        "file://" + process.cwd() + "/tests/time-clock/",
      ),
      "utf8",
    ),
  );
  const pin = "1234",
    secret = process.env.TIME_CLOCK_SECRET;
  const worker = await createAdminClient().rpc("tc_admin", {
    p_actor: ownerId,
    p_action: "save_worker",
    p_payload: {
      name: "Jordan Lee (QA)",
      category: "employee",
      active: true,
      pay_basis: "hourly",
      flat_cents: null,
      pin_lookup: keyedHash("pin-lookup", pin, secret),
      pin_verifier: await hashPin(pin, secret),
      roles: [
        { role_id: "bartender", rate_cents: 2200 },
        { role_id: "floor_support", rate_cents: 1800 },
        { role_id: "front_door", rate_cents: 2000 },
      ],
    },
  });
  if (worker.error) throw new Error(worker.error.message);
  await createAdminClient().rpc("tc_admin", {
    p_actor: ownerId,
    p_action: "create_kiosk",
    p_payload: {
      label: "Front room QA iPad",
      pairing_hash: keyedHash("pair", "12345678", secret),
    },
  });
}
// Synthetic seed for the schedule calendar and employee portal preview.
export async function seedSchedule() {
  const rpcs = createAdminClient();
  const mk = async (name, letter, roles) =>
    (await rpcs.rpc("tc_admin", {
      p_actor: ownerId, p_action: "save_worker",
      p_payload: { name, category: "employee", active: true, pay_basis: "hourly", flat_cents: null,
        pin_lookup: letter.repeat(64), pin_verifier: "qa-only", roles },
    })).data.id;
  const sam = await mk("Sam Rivera (QA)", "e", [{ role_id: "front_door", rate_cents: 2000 }]);
  const kai = await mk("Kai Morgan (QA)", "f", [{ role_id: "floor_support", rate_cents: 1800 }, { role_id: "bartender", rate_cents: 2100 }]);
  const jordan = (await testDb.query("select id from tc_workers where name like 'Jordan%'")).rows[0].id;
  await rpcs.rpc("tc_login_admin", { p_actor: ownerId, p_action: "link_login",
    p_payload: { worker_id: jordan, user_id: employeeId, username: "jordan", managed: true } });
  const austin = (dayOffset, hh, mm = 0) => {
    const d = new Date(Date.now() + dayOffset * 86400000);
    const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(d);
    return new Date(`${ymd}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00-05:00`).toISOString();
  };
  const plan = [
    [0, [[jordan, "bartender"], [sam, "front_door"], [kai, "floor_support"]], 20, 26],
    [1, [[jordan, "bartender"], [kai, "bartender"]], 21, 27],
    [7, [[jordan, "front_door"], [sam, "front_door"]], 19, 25],
    [14, [[kai, "floor_support"]], 18, 23],
  ];
  for (const [day, people, start, end] of plan)
    await rpcs.rpc("tc_schedule_admin", { p_actor: ownerId, p_action: "create_schedule", p_payload: {
      entries: people.map(([worker_id, role_id]) => ({ worker_id, role_id,
        starts_at: austin(day, start), ends_at: austin(day + Math.floor(end / 24), end % 24), note: day === 0 ? "Doors 9pm" : "" })) } });
  // Two completed historical shifts for Jordan's hours view (fixture-only SQL).
  const kiosk = (await testDb.query("select id from tc_kiosks limit 1")).rows[0].id;
  for (const back of [3, 6]) {
    const s = austin(-back, 20), e = austin(-back + 1, 2);
    const shift = (await testDb.query(
      "insert into tc_shifts(worker_id,kiosk_id,started_at,ended_at,pay_basis,status) values($1,$2,$3,$4,'hourly','approved') returning id",
      [jordan, kiosk, s, e])).rows[0].id;
    await testDb.query("insert into tc_segments(shift_id,role_id,role_name,rate_cents,started_at,ended_at) values($1,'bartender','Bartender',2200,$2,$3)", [shift, s, e]);
  }
}
// Synthetic employee requests for the hub and manager-queue preview.
export async function seedRequests() {
  const rpcs = createAdminClient();
  const ask = (payload) => rpcs.rpc("tc_employee_request", { p_user: employeeId, p_action: "create", p_payload: payload });
  const shifts = (await testDb.query("select id,started_at,ended_at from tc_shifts order by started_at")).rows;
  const s = shifts[0];
  const r1 = await ask({ kind: "edit_shift", shift_id: s.id,
    starts_at: new Date(Date.parse(s.started_at) - 30 * 60000).toISOString(),
    ends_at: new Date(s.ended_at).toISOString(), reason: "Got here at 7:30 to set up the bar but the iPad was frozen." });
  if (r1.error) throw new Error(r1.error.message);
  const d = new Date(Date.now() + 10 * 86400000);
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(d);
  const start = new Date(`${ymd}T00:00:00-05:00`).toISOString();
  const end = new Date(Date.parse(start) + 2 * 86400000).toISOString();
  const r2 = await ask({ kind: "time_off", starts_at: start, ends_at: end, reason: "Family wedding in Houston." });
  if (r2.error) throw new Error(r2.error.message);
}
const authAdmin = {
  async createUser({ email, app_metadata }) {
    const { rows } = await testDb.query("insert into auth.users(id,email,raw_app_meta_data) values(gen_random_uuid(),$1,$2) returning id,email", [email, JSON.stringify(app_metadata || {})]);
    return { data: { user: rows[0] }, error: null };
  },
  async getUserById(id) {
    const { rows } = await testDb.query("select id,email from auth.users where id=$1", [id]);
    return { data: { user: rows[0] || null }, error: null };
  },
  async updateUserById() { return { data: {}, error: null }; },
  async deleteUser(id) { await testDb.query("delete from auth.users where id=$1", [id]); return { error: null }; },
};
export function createAdminClient() {
  return {
    auth: { admin: authAdmin },
    async rpc(name, args = {}) {
      try {
        if (!/^tc_[a-z_]+$/.test(name))
          throw new Error("Only test time-clock RPCs");
        const entries = Object.entries(args);
        const sql = `select public.${ident(name)}(${entries.map(([key], i) => `${ident(key)} => $${i + 1}`).join(",")}) as result`;
        const values = entries.map(([, v]) =>
          v && typeof v === "object" ? JSON.stringify(v) : v,
        );
        return {
          data: (await testDb.query(sql, values)).rows[0].result,
          error: null,
        };
      } catch (e) {
        return { data: null, error: { message: e.message, code: e.code } };
      }
    },
    from(table) {
      if (!/^tc_[a-z_]+$/.test(table))
        throw new Error("Only test time-clock tables");
      let columns = "*",
        limit = "",
        order = "",
        single = false;
      const clauses = [],
        values = [];
      function filter(column, op, value) {
        values.push(value);
        clauses.push(`${ident(column)} ${op} $${values.length}`);
        return builder;
      }
      const builder = {
        select(s) {
          columns = s;
          return builder;
        },
        eq(c, v) {
          return filter(c, "=", v);
        },
        gte(c, v) {
          return filter(c, ">=", v);
        },
        lte(c, v) {
          return filter(c, "<=", v);
        },
        lt(c, v) {
          return filter(c, "<", v);
        },
        gt(c, v) {
          return filter(c, ">", v);
        },
        is(c, v) {
          if (v !== null) throw new Error("unsupported");
          clauses.push(`${ident(c)} is null`);
          return builder;
        },
        in(c, v) {
          values.push(v);
          clauses.push(`${ident(c)}=any($${values.length}::uuid[])`);
          return builder;
        },
        order(c, opts = {}) {
          order = ` order by ${ident(c)} ${opts.ascending === false ? "desc" : "asc"}`;
          return builder;
        },
        limit(n) {
          limit = ` limit ${Number(n)}`;
          return builder;
        },
        maybeSingle() {
          single = true;
          return builder;
        },
        async then(resolve, reject) {
          try {
            const nested = columns.includes("tc_workers(");
            const projection = nested
              ? "*"
              : columns === "*"
                ? "*"
                : columns.split(",").map(ident).join(",");
            const { rows } = await testDb.query(
              `select ${projection} from public.${ident(table)}${clauses.length ? " where " + clauses.join(" and ") : ""}${order}${limit}`,
              values,
            );
            if (nested)
              for (const s of rows) {
                s.tc_workers = (
                  await testDb.query(
                    "select name,category from tc_workers where id=$1",
                    [s.worker_id],
                  )
                ).rows[0];
                for (const child of ["tc_segments", "tc_tasks", "tc_breaks"])
                  s[child] = (
                    await testDb.query(
                      `select * from ${child} where shift_id=$1`,
                      [s.id],
                    )
                  ).rows;
              }
            return resolve({
              data: single ? rows[0] || null : rows,
              error: null,
            });
          } catch (e) {
            return resolve({
              data: null,
              error: { message: e.message, code: e.code },
            });
          }
        },
      };
      return builder;
    },
  };
}
// Synthetic month of punches for the owner timesheet calendar preview
// (fixture-only SQL). Mix of approved and waiting shifts, plus two scheduled
// shifts with no clock-in.
export async function seedTimesheetMonth() {
  const workers = (await testDb.query("select id,name from tc_workers order by name")).rows;
  const by = (prefix) => workers.find((w) => w.name.startsWith(prefix))?.id;
  const kiosk = (await testDb.query("select id from tc_kiosks limit 1")).rows[0].id;
  const at = (back, hh, mm = 0) => {
    const d = new Date(Date.now() - back * 86400000);
    const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(d);
    return new Date(Date.parse(`${ymd}T00:00:00-05:00`) + (hh * 60 + mm) * 60000).toISOString();
  };
  const roles = { "Sam": ["front_door", "Front door", 2000], "Kai": ["floor_support", "Floor support", 1800] };
  const plan = [
    ["Sam", 1, 19, 0, 25, 10, "pending"], ["Kai", 1, 20, 30, 26, 0, "pending"],
    ["Sam", 2, 19, 5, 24, 45, "pending"], ["Kai", 4, 18, 0, 23, 30, "approved"],
    ["Sam", 5, 19, 0, 25, 0, "approved"], ["Kai", 5, 20, 0, 26, 15, "approved"],
    ["Sam", 8, 19, 0, 25, 30, "approved"], ["Kai", 9, 21, 0, 27, 0, "approved"],
    ["Sam", 9, 18, 50, 24, 0, "approved"], ["Kai", 11, 19, 0, 25, 0, "approved"],
    ["Sam", 12, 20, 0, 26, 0, "approved"], ["Kai", 12, 20, 0, 25, 40, "approved"],
  ];
  for (const [who, back, h1, m1, h2, m2, status] of plan) {
    const id = by(who);
    if (!id) continue;
    const [role, roleName, rate] = roles[who];
    const s = at(back, h1, m1), e = at(back, h2, m2);
    const shift = (await testDb.query(
      "insert into tc_shifts(worker_id,kiosk_id,started_at,ended_at,pay_basis,status) values($1,$2,$3,$4,'hourly',$5) returning id",
      [id, kiosk, s, e, status])).rows[0].id;
    await testDb.query("insert into tc_segments(shift_id,role_id,role_name,rate_cents,started_at,ended_at) values($1,$2,$3,$4,$5,$6)",
      [shift, role, roleName, rate, s, e]);
  }
  for (const [who, back, role] of [["Kai", 2, "floor_support"], ["Sam", 4, "front_door"]]) {
    const id = by(who);
    if (id) await testDb.query("insert into tc_schedule(worker_id,role_id,starts_at,ends_at,created_by) values($1,$2,$3,$4,$5)",
      [id, role, at(back, 20), at(back, 26), ownerId]);
  }
}
