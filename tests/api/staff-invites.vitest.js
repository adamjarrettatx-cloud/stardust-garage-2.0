import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendStaffInvite: vi.fn() }));
vi.mock("@/lib/auth-helpers", () => ({
  requireAdminMfa: vi.fn(),
  adminPageGate: vi.fn(),
  getRequestUser: vi.fn(),
}));
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { sendStaffInvite } from "@/lib/email";
import { requireAdminMfa, getRequestUser } from "@/lib/auth-helpers";
import { POST as invitePost } from "../../app/api/admin/time-clock/invite/route.js";
import { POST as setupPost } from "../../app/api/employee/setup/route.js";
import { POST as profilePost } from "../../app/api/employee/profile/route.js";
import { keyedHash, verifyPin } from "../../lib/time-clock/crypto.mjs";
import { isWeakPin, birthdateProblem, suggestUsername } from "../../lib/time-clock/profile.mjs";

const secret = "test-only-time-clock-secret-".repeat(3);
const origin = "https://www.sdgatx.com";
const actor = { id: "11111111-1111-4111-8111-111111111111", email: "adam@sdgatx.com" };
const workerId = "55555555-5555-4555-8555-555555555555";
const token = "T".repeat(43);
let client, rows, rpcResults, storage, authAdmin, signIn;

function chain(result) {
  const q = {
    select: vi.fn(() => q), eq: vi.fn(() => q), neq: vi.fn(() => q), is: vi.fn(() => q),
    order: vi.fn(() => q), limit: vi.fn(() => q),
    maybeSingle: vi.fn(async () => result()),
  };
  return q;
}
const jsonReq = (path, input, headers = { Origin: origin }) =>
  new Request(`${origin}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(input),
  });
function setupReq(fields, headers = { Origin: origin }) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return new Request(`${origin}/api/employee/setup`, { method: "POST", headers, body: form });
}
const jpeg = () => new File([new Uint8Array(4096)], "me.jpg", { type: "image/jpeg" });
const goodSetup = () => ({
  token, pin: "4826", pin_confirm: "4826", username: "avery.stone",
  birthdate: "1995-04-02", password: "correct-horse-1", photo: jpeg(),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TIME_CLOCK_ENABLED", "true");
  vi.stubEnv("TIME_CLOCK_SECRET", secret);
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://sdgatx.com");
  requireAdminMfa.mockResolvedValue({ user: actor, isAdmin: true, unauthorized: false });
  rows = {
    tc_workers: { data: { id: workerId, name: "Avery Stone", active: true, user_id: null }, error: null },
    tc_invites: { data: null, error: null },
  };
  rpcResults = {
    tc_take_limit: true,
    tc_auth_user_by_email: null,
    tc_invite_admin: { id: "i", expires_at: "2026-10-17T00:00:00Z", email: "avery@example.test" },
    tc_invite_peek: { kind: "setup", email: "avery@example.test", worker_id: workerId, name: "Avery Stone", roles: [] },
    tc_invite_redeem: { id: workerId },
    tc_employee_profile: { id: workerId },
  };
  storage = { upload: vi.fn(async () => ({ error: null })), remove: vi.fn(async () => ({ error: null })) };
  authAdmin = {
    createUser: vi.fn(async () => ({ data: { user: { id: "99999999-9999-4999-8999-999999999999" } }, error: null })),
    updateUserById: vi.fn(async () => ({ error: null })),
    deleteUser: vi.fn(async () => ({ error: null })),
    getUserById: vi.fn(async () => ({ data: { user: { email: "avery@example.test" } } })),
  };
  // Worker lookups by PIN/username in the setup route return "not taken".
  client = {
    from: vi.fn((table) => chain(() => (table === "tc_workers" && client.lookupMode ? { data: null, error: null } : rows[table]))),
    rpc: vi.fn(async (name) => {
      const value = rpcResults[name];
      if (value instanceof Error) return { data: null, error: { message: value.message } };
      return { data: value === undefined ? {} : value, error: null };
    }),
    storage: { from: vi.fn(() => storage) },
    auth: { admin: authAdmin },
  };
  createAdminClient.mockReturnValue(client);
  signIn = vi.fn(async () => ({ error: null }));
  createClient.mockResolvedValue({ auth: { signInWithPassword: signIn } });
  sendStaffInvite.mockResolvedValue({ id: "email" });
});

it("PIN and birthday rules", () => {
  for (const weak of ["0000", "1111", "1234", "4321", "6789", "9876", "1212", "2580"]) expect(isWeakPin(weak)).toBe(true);
  for (const ok of ["4826", "0731", "1359"]) expect(isWeakPin(ok)).toBe(false);
  expect(birthdateProblem("1995-04-02", "2026-10-13")).toBeNull();
  expect(birthdateProblem("1995-02-30", "2026-10-13")).toMatch(/valid/);
  expect(birthdateProblem("2015-01-01", "2026-10-13")).toMatch(/Check/);
  expect(birthdateProblem("", "2026-10-13")).toMatch(/Enter/);
  expect(suggestUsername("Abashawl Samson")).toBe("abashawl.samson");
  expect(suggestUsername("José (QA) Núñez")).toBe("jose.nunez");
});

it("sends an invite email with a single-use link and stores only its hash", async () => {
  const res = await invitePost(jsonReq("/api/admin/time-clock/invite", { action: "send", payload: { worker_id: workerId, email: "Avery@Example.test" } }));
  expect(res.status).toBe(200);
  const create = client.rpc.mock.calls.find(([n, a]) => n === "tc_invite_admin" && a.p_action === "create")[1];
  expect(create.p_actor).toBe(actor.id);
  expect(create.p_payload).toMatchObject({ worker_id: workerId, kind: "setup", email: "avery@example.test" });
  expect(create.p_payload.token_hash).toHaveLength(64);
  const mail = sendStaffInvite.mock.calls[0][0];
  expect(mail).toMatchObject({ email: "avery@example.test", fullName: "Avery Stone", kind: "setup" });
  const sentToken = new URL(mail.setupUrl).searchParams.get("token");
  expect(mail.setupUrl.startsWith("https://sdgatx.com/employee/setup?token=")).toBe(true);
  expect(keyedHash("staff-invite", sentToken, secret)).toBe(create.p_payload.token_hash);
  expect(JSON.stringify(create)).not.toContain(sentToken);
});

it("cancels the invite when the email cannot be sent", async () => {
  sendStaffInvite.mockRejectedValue(new Error("resend down"));
  const res = await invitePost(jsonReq("/api/admin/time-clock/invite", { action: "send", payload: { worker_id: workerId, email: "a@example.test" } }));
  expect(res.status).toBe(502);
  expect(client.rpc.mock.calls.some(([n, a]) => n === "tc_invite_admin" && a.p_action === "revoke")).toBe(true);
});

it("refuses team, partner and station emails, and non-managers", async () => {
  rpcResults.tc_auth_user_by_email = { id: "x", team: true };
  const team = await invitePost(jsonReq("/api/admin/time-clock/invite", { action: "send", payload: { worker_id: workerId, email: "jeyu@sdgatx.com" } }));
  expect(team.status).toBe(409);
  expect(sendStaffInvite).not.toHaveBeenCalled();
  requireAdminMfa.mockResolvedValue({ user: { id: "x", email: "someone@sdgatx.com" }, isAdmin: true, unauthorized: false });
  const outsider = await invitePost(jsonReq("/api/admin/time-clock/invite", { action: "send", payload: { worker_id: workerId, email: "a@example.test" } }));
  expect(outsider.status).toBe(403);
  const crossSite = await invitePost(jsonReq("/api/admin/time-clock/invite", { action: "cancel", payload: { worker_id: workerId } }, { Origin: "https://attacker.test" }));
  expect(crossSite.status).toBe(403);
});

it("sets up a new account: validates first, hashes the PIN, stores the photo privately and signs in", async () => {
  client.lookupMode = true;
  const res = await setupPost(setupReq(goodSetup()));
  expect(res.status).toBe(200);
  expect((await res.json()).destination).toBe("/employee");
  const [path] = storage.upload.mock.calls[0];
  expect(path).toMatch(new RegExp(`^staff/${workerId}/[0-9a-f-]{36}\\.jpg$`));
  expect(authAdmin.createUser.mock.calls[0][0]).toMatchObject({
    email: "avery@example.test", password: "correct-horse-1", email_confirm: true, app_metadata: { employee_account: true },
  });
  const redeem = client.rpc.mock.calls.find(([n]) => n === "tc_invite_redeem")[1];
  expect(redeem.p_token_hash).toBe(keyedHash("staff-invite", token, secret));
  expect(redeem.p_payload).toMatchObject({ username: "avery.stone", managed: true, birthdate: "1995-04-02", photo_path: path });
  expect(redeem.p_payload.pin_lookup).toBe(keyedHash("pin-lookup", "4826", secret));
  expect(await verifyPin("4826", redeem.p_payload.pin_verifier, secret)).toBe(true);
  expect(JSON.stringify(redeem)).not.toContain("4826");
  expect(signIn).toHaveBeenCalledWith({ email: "avery@example.test", password: "correct-horse-1" });
});

it("rejects bad input before creating any account or uploading anything", async () => {
  client.lookupMode = true;
  const bad = [
    { pin: "1234", pin_confirm: "1234" },
    { pin: "4826", pin_confirm: "4827" },
    { birthdate: "" },
    { birthdate: "2020-01-01" },
    { password: "short" },
    { username: "No Spaces!" },
  ];
  for (const change of bad) {
    const res = await setupPost(setupReq({ ...goodSetup(), ...change }));
    expect(res.status).toBe(400);
  }
  const noPhoto = goodSetup();
  delete noPhoto.photo;
  expect((await setupPost(setupReq(noPhoto))).status).toBe(400);
  expect(storage.upload).not.toHaveBeenCalled();
  expect(authAdmin.createUser).not.toHaveBeenCalled();
});

it("refuses a PIN already used by a coworker without saying whose", async () => {
  rows.tc_workers = { data: { id: "other" }, error: null };
  const res = await setupPost(setupReq(goodSetup()));
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe("That PIN can't be used. Choose a different one.");
  expect(authAdmin.createUser).not.toHaveBeenCalled();
});

it("undoes the new account and photo if the final step fails", async () => {
  client.lookupMode = true;
  rpcResults.tc_invite_redeem = new Error("pin_taken");
  const res = await setupPost(setupReq(goodSetup()));
  expect(res.status).toBe(409);
  expect(authAdmin.deleteUser).toHaveBeenCalledWith("99999999-9999-4999-8999-999999999999");
  expect(storage.remove).toHaveBeenCalled();
  expect(signIn).not.toHaveBeenCalled();
});

it("links an existing SDG account without touching its password", async () => {
  client.lookupMode = true;
  rpcResults.tc_auth_user_by_email = { id: "88888888-8888-4888-8888-888888888888" };
  const fields = goodSetup();
  delete fields.password;
  const res = await setupPost(setupReq(fields));
  expect(res.status).toBe(200);
  expect(authAdmin.createUser).not.toHaveBeenCalled();
  expect(authAdmin.updateUserById).toHaveBeenCalledWith("88888888-8888-4888-8888-888888888888", { app_metadata: { employee_account: true } });
  expect(client.rpc.mock.calls.find(([n]) => n === "tc_invite_redeem")[1].p_payload.managed).toBe(false);
  expect(signIn).not.toHaveBeenCalled();
});

it("expired or unknown links and cross-site posts are refused", async () => {
  rpcResults.tc_invite_peek = null;
  expect((await setupPost(setupReq(goodSetup()))).status).toBe(410);
  expect((await setupPost(setupReq({ ...goodSetup(), token: "short" }))).status).toBe(410);
  expect((await setupPost(setupReq(goodSetup(), { Origin: "https://attacker.test" }))).status).toBe(403);
});

it("PIN reset links only change the PIN", async () => {
  client.lookupMode = true;
  rpcResults.tc_invite_peek = { kind: "pin", email: "avery@example.test", worker_id: workerId, name: "Avery Stone", roles: [] };
  const res = await setupPost(setupReq({ token, pin: "4826", pin_confirm: "4826" }));
  expect(res.status).toBe(200);
  const redeem = client.rpc.mock.calls.find(([n]) => n === "tc_invite_redeem")[1].p_payload;
  expect(Object.keys(redeem).sort()).toEqual(["pin_lookup", "pin_verifier"]);
  expect(authAdmin.createUser).not.toHaveBeenCalled();
  expect(storage.upload).not.toHaveBeenCalled();
});

it("employees change only their own PIN and profile", async () => {
  getRequestUser.mockResolvedValue({ id: "33333333-3333-4333-8333-333333333333" });
  rows.tc_workers = { data: { id: workerId }, error: null };
  const res = await profilePost(jsonReq("/api/employee/profile", { action: "set_pin", pin: "4826", pin_confirm: "4826", worker_id: "evil" }));
  expect(res.status).toBe(200);
  const call = client.rpc.mock.calls.find(([n]) => n === "tc_employee_profile")[1];
  expect(call.p_user).toBe("33333333-3333-4333-8333-333333333333");
  expect(call.p_payload.worker_id).toBeUndefined();
  expect((await profilePost(jsonReq("/api/employee/profile", { action: "set_pin", pin: "0000", pin_confirm: "0000" }))).status).toBe(400);
  getRequestUser.mockResolvedValue(null);
  expect((await profilePost(jsonReq("/api/employee/profile", { action: "set_pin", pin: "4826", pin_confirm: "4826" }))).status).toBe(401);
});
