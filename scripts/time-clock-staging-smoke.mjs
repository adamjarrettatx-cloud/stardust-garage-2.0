// Run ONLY against a separately approved, empty Supabase time-clock staging
// branch after applying the reviewed migration. No live environment fallback.
// This script creates synthetic records and leaves them for inspection.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { hashPin, keyedHash, verifyPin } from "../lib/time-clock/crypto.mjs";

const ref = process.env.TC_STAGING_PROJECT_REF;
const url = process.env.TC_STAGING_URL;
const serviceKey = process.env.TC_STAGING_SERVICE_KEY;
const publicKey = process.env.TC_STAGING_PUBLIC_KEY;
if (
  process.env.TC_STAGING_APPROVED !== "yes" ||
  !/^[a-z]{20}$/.test(ref || "") ||
  ref === "iwgfelvbebqbaotkylsw" ||
  url !== `https://${ref}.supabase.co` ||
  !serviceKey ||
  !publicKey
) {
  throw new Error(
    "Explicit isolated staging URL/ref, keys and approval required. Production is forbidden.",
  );
}
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const db = createClient(url, serviceKey, options);
const anon = createClient(url, publicKey, options);
const run = randomUUID();
const secret = randomUUID() + randomUUID();
const hash = (purpose, value) => keyedHash(purpose, value, secret);
async function checked(result) {
  if (result.error)
    throw new Error(
      `Staging request failed (${result.error.code || result.error.status || "unknown"}).`,
    );
  return result.data;
}
async function rpc(name, args) {
  return checked(await db.rpc(name, args));
}
// Do not reuse or clear a prior run. Empty staging only.
const existing = await checked(
  await db.from("tc_workers").select("id").limit(1),
);
assert.equal(
  existing.length,
  0,
  "Use a fresh time-clock staging database; this runner never deletes records.",
);

const created = await checked(
  await db.auth.admin.createUser({
    email: `tc-${run}@example.invalid`,
    email_confirm: true,
  }),
);
const actor = created.user.id;
async function admin(action, payload) {
  return rpc("tc_admin", {
    p_actor: actor,
    p_action: action,
    p_payload: payload,
  });
}
const pin = "0456";
const profile = {
  name: "Synthetic time-clock staging test",
  category: "contractor",
  active: true,
  pay_basis: "hourly",
  flat_cents: null,
  roles: [
    { role_id: "bartender", rate_cents: 2200 },
    { role_id: "floor_support", rate_cents: 1800 },
  ],
  pin_lookup: hash("pin-lookup", pin),
  pin_verifier: await hashPin(pin, secret),
};
const worker = await admin("save_worker", profile);
const pinRow = await checked(
  await db
    .from("tc_workers")
    .select("id,pin_verifier,credential_version")
    .eq("pin_lookup", profile.pin_lookup)
    .eq("active", true)
    .single(),
);
assert.equal(await verifyPin(pin, pinRow.pin_verifier, secret), true);
const kiosk = await admin("create_kiosk", {
  label: "Synthetic staging kiosk",
  pairing_hash: hash("pair", run),
});
const deviceHash = hash("device", run);
const sessionHash = hash("session", run);
await rpc("tc_pair", {
  p_pair_hash: hash("pair", run),
  p_token_hash: deviceHash,
});
const session = {
  p_kiosk_hash: deviceHash,
  p_worker: worker.id,
  p_version: pinRow.credential_version,
  p_session_hash: sessionHash,
};
await rpc("tc_start_session", session);
const authArgs = { p_kiosk_hash: deviceHash, p_session_hash: sessionHash };
async function operate(action, payload) {
  return rpc("tc_operate", {
    ...authArgs,
    p_request: randomUUID(),
    p_action: action,
    p_payload: payload,
  });
}
const punch = {
  ...authArgs,
  p_request: randomUUID(),
  p_action: "clock_in",
  p_payload: { role_id: "bartender" },
};
const first = await rpc("tc_operate", punch);
const repeat = await rpc("tc_operate", punch);
assert.equal(repeat.shift.id, first.shift.id);
assert.equal(Object.hasOwn(first.shift.segments[0], "rate_cents"), false);
await operate("task", {
  shift_id: first.shift.id,
  task_id: first.shift.tasks[0].id,
  done: true,
});
await operate("break_start", { shift_id: first.shift.id });
await operate("break_end", { shift_id: first.shift.id });
await operate("switch_role", {
  shift_id: first.shift.id,
  role_id: "floor_support",
});
await operate("clock_out", {
  shift_id: first.shift.id,
  note: "Synthetic hosted smoke test",
});

// Exact report relationship embedding used by the Next.js management route.
const rows = await checked(
  await db
    .from("tc_shifts")
    .select(
      "id,worker_id,started_at,ended_at,status,version,pay_basis,flat_cents,note,tc_workers(name,category),tc_segments(*),tc_tasks(*),tc_breaks(*)",
    )
    .eq("id", first.shift.id),
);
assert.equal(rows.length, 1);
assert.equal(rows[0].tc_workers.name, profile.name);
assert.equal(rows[0].tc_segments.length, 2);
assert.equal(rows[0].tc_breaks.length, 1);
assert.equal(rows[0].tc_tasks.length, 6);
await admin("approve", {
  id: first.shift.id,
  version: rows[0].version,
  reason: "Synthetic review",
});

await admin("save_worker", { ...profile, id: worker.id, active: false });
await admin("save_worker", { ...profile, id: worker.id, active: true });
assert.equal(
  (await rpc("tc_state", { ...authArgs, p_touch: false })).authenticated,
  false,
);
assert.ok(
  (await db.rpc("tc_start_session", session)).error,
  "Old credential version must fail.",
);
const refreshed = await checked(
  await db
    .from("tc_workers")
    .select("credential_version")
    .eq("id", worker.id)
    .single(),
);
await rpc("tc_start_session", {
  ...session,
  p_version: refreshed.credential_version,
});
assert.equal(
  (await rpc("tc_state", { ...authArgs, p_touch: false })).authenticated,
  true,
);
const inactive = await admin("save_worker", {
  ...profile,
  name: "Synthetic inactive profile",
  active: false,
  pin_lookup: hash("pin-lookup", "0567"),
  pin_verifier: await hashPin("0567", secret),
});
assert.equal(
  (
    await checked(
      await db
        .from("tc_workers")
        .select("active")
        .eq("id", inactive.id)
        .single(),
    )
  ).active,
  false,
);
assert.ok(
  (await anon.from("tc_workers").select("id")).error,
  "Anonymous roster read must fail.",
);
assert.ok((await anon.rpc("tc_cleanup")).error, "Anonymous RPC must fail.");
assert.ok(
  (
    await db
      .from("tc_workers")
      .update({ name: "Must not write" })
      .eq("id", worker.id)
  ).error,
  "Direct service writes must fail.",
);
await admin("revoke_kiosk", { id: kiosk.id });
assert.ok((await db.rpc("tc_state", { ...authArgs, p_touch: false })).error);
console.log(
  JSON.stringify(
    {
      status: "PASS",
      project_ref: ref,
      run,
      verified: [
        "PIN lookup",
        "paired kiosk",
        "retry deduplication",
        "role/break/task/clock-out",
        "report relationship embedding",
        "approval",
        "deactivation/reactivation",
        "inactive creation",
        "anonymous denials",
        "service direct-write denial",
        "kiosk revocation",
      ],
      note: "Synthetic data retained. Does not certify Next.js sign-in, proxy settings, CSV UI, or physical iPad.",
    },
    null,
    2,
  ),
);
