import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/auth-helpers", () => ({
  requireAdminMfa: vi.fn(),
  adminPageGate: vi.fn(),
  getRequestUser: vi.fn(),
}));
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminMfa, getRequestUser } from "@/lib/auth-helpers";
import { POST as employeePost } from "../../app/api/employee/requests/route.js";
import { GET as meGet } from "../../app/api/employee/me/route.js";
import {
  GET as queueGet,
  POST as queuePost,
} from "../../app/api/admin/time-clock/requests/route.js";

const origin = "https://www.sdgatx.com";
const user = { id: "33333333-3333-4333-8333-333333333333" };
const shiftId = "44444444-4444-4444-8444-444444444444";
let client;
const post = (path, input, headers = {}) =>
  new Request(`${origin}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(input),
  });
const create = {
  action: "create",
  kind: "edit_shift",
  shift_id: shiftId,
  starts_at: "2026-10-08T00:30:00Z",
  ends_at: "2026-10-08T07:00:00Z",
  reason: "Clocked in late",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TIME_CLOCK_ENABLED", "true");
  vi.stubEnv("TIME_CLOCK_SECRET", "test-only-time-clock-secret-".repeat(3));
  getRequestUser.mockResolvedValue(user);
  requireAdminMfa.mockResolvedValue({ user: { id: "11111111-1111-4111-8111-111111111111", email: "adam@sdgatx.com" }, isAdmin: true, unauthorized: false });
  client = {
    rpc: vi.fn(async (name) => ({
      data: name === "tc_take_limit" ? true : name === "tc_requests_view" ? [] : { id: "x", status: "pending" },
      error: null,
    })),
  };
  createAdminClient.mockReturnValue(client);
});

it("accepts website writes only with a same-site Origin", async () => {
  expect((await employeePost(post("/api/employee/requests", create))).status).toBe(403);
  expect((await employeePost(post("/api/employee/requests", create, { Origin: "https://attacker.test" }))).status).toBe(403);
  expect((await employeePost(post("/api/employee/requests", create, { Origin: origin }))).status).toBe(200);
});

it("accepts app writes with a bearer token and no Origin", async () => {
  const res = await employeePost(post("/api/employee/requests", create, { Authorization: "Bearer abc.def.ghi" }));
  expect(res.status).toBe(200);
  const call = client.rpc.mock.calls.find(([n]) => n === "tc_employee_request");
  expect(call[1].p_user).toBe(user.id);
  expect(call[1].p_payload).toEqual({
    kind: "edit_shift", shift_id: shiftId, reason: "Clocked in late",
    starts_at: "2026-10-08T00:30:00.000Z", ends_at: "2026-10-08T07:00:00.000Z",
  });
});

it("never lets the browser choose the worker and validates input before the database", async () => {
  const sent = { ...create, worker_id: "55555555-5555-4555-8555-555555555555", p_user: "evil" };
  await employeePost(post("/api/employee/requests", sent, { Origin: origin }));
  const call = client.rpc.mock.calls.find(([n]) => n === "tc_employee_request");
  expect(call[1].p_user).toBe(user.id);
  expect(call[1].p_payload.worker_id).toBeUndefined();
  for (const bad of [{ ...create, kind: "raise" }, { ...create, starts_at: "2026-10-08 00:30" }, { ...create, reason: "" }, { ...create, shift_id: "nope" }]) {
    client.rpc.mockClear();
    expect((await employeePost(post("/api/employee/requests", bad, { Origin: origin }))).status).toBe(400);
    expect(client.rpc.mock.calls.some(([n]) => n === "tc_employee_request")).toBe(false);
  }
});

it("requires a signed-in user", async () => {
  getRequestUser.mockResolvedValue(null);
  expect((await employeePost(post("/api/employee/requests", create, { Origin: origin }))).status).toBe(401);
  expect((await meGet(new Request(`${origin}/api/employee/me?days=14`))).status).toBe(401);
});

it("accepts Austin pay-week ranges up to 93 days", async () => {
  client.rpc.mockResolvedValueOnce({ data: { worker: {}, shifts: [], schedule: [], requests: [] }, error: null });
  const ok = await meGet(new Request(`${origin}/api/employee/me?from=2026-10-05&to=2026-10-11`));
  expect(ok.status).toBe(200);
  const args = client.rpc.mock.calls[0][1];
  expect(args.p_from).toBe("2026-10-05T05:00:00.000Z");
  expect(args.p_to).toBe("2026-10-12T05:00:00.000Z");
  expect((await meGet(new Request(`${origin}/api/employee/me?from=2026-01-01&to=2026-12-31`))).status).toBe(400);
});

it("keeps the approval queue manager-only", async () => {
  requireAdminMfa.mockResolvedValue({ unauthorized: true, reason: "not_owner" });
  expect((await queueGet(new Request(`${origin}/api/admin/time-clock/requests`))).status).toBe(403);
  const decision = { action: "approve", id: shiftId, version: 1 };
  expect((await queuePost(post("/api/admin/time-clock/requests", decision, { Origin: origin }))).status).toBe(403);
  expect(client.rpc.mock.calls.some(([n]) => n === "tc_request_admin")).toBe(false);
});

it("passes manager decisions through with the verified actor", async () => {
  const res = await queuePost(post("/api/admin/time-clock/requests", { action: "deny", id: shiftId, version: 2, note: "Short staffed" }, { Origin: origin }));
  expect(res.status).toBe(200);
  const call = client.rpc.mock.calls.find(([n]) => n === "tc_request_admin");
  expect(call[1]).toEqual({ p_actor: "11111111-1111-4111-8111-111111111111", p_action: "deny", p_payload: { id: shiftId, version: 2, note: "Short staffed" } });
  expect((await queuePost(post("/api/admin/time-clock/requests", { action: "delete", id: shiftId, version: 2 }, { Origin: origin }))).status).toBe(400);
});
