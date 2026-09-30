// Local-only QA adapter. Never imported by production files.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { hashPin, keyedHash } from "../../lib/time-clock/crypto.mjs";
export const testDb = new PGlite();
export const ownerId = "11111111-1111-4111-8111-111111111111";
const ident = (name) => {
  if (!/^[a-z_]+$/.test(name)) throw new Error("Invalid SQL identifier");
  return `"${name}"`;
};
export async function initialize() {
  await testDb.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key); insert into auth.users values('${ownerId}');`);
  await testDb.exec(
    readFileSync(
      new URL(
        "../../supabase/migrations/20260930031000_staff_time_clock.sql",
        "file://" + process.cwd() + "/tests/time-clock/",
      ),
      "utf8",
    ),
  );
  const pin = "123456",
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
export function createAdminClient() {
  return {
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
