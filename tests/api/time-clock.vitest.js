import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/auth-helpers", () => ({ requireOwnerMfa: vi.fn() }));
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOwnerMfa } from "@/lib/auth-helpers";
import { GET, POST } from "../../app/api/time-clock/[action]/route.js";
import {
  GET as ownerGet,
  POST as ownerPost,
} from "../../app/api/admin/time-clock/route.js";
import { keyedHash, hashPin } from "../../lib/time-clock/crypto.mjs";

const secret = "test-only-time-clock-secret-".repeat(3);
const actor = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const origin = "https://www.sdgatx.com";
let client, query;
function req(action, input = {}, options = {}) {
  return new Request(`${origin}/api/time-clock/${action}`, {
    method: options.method || "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: options.origin ?? origin,
      Cookie: `sdg_tc_device=${"A".repeat(43)}; sdg_tc_session=${"B".repeat(43)}`,
      ...options.headers,
    },
    ...(options.method === "GET" ? {} : { body: JSON.stringify(input) }),
  });
}
const ctx = (action) => ({ params: Promise.resolve({ action }) });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("TIME_CLOCK_ENABLED", "true");
  vi.stubEnv("TIME_CLOCK_SECRET", secret);
  requireOwnerMfa.mockResolvedValue({
    user: { id: actor },
    unauthorized: false,
  });
  query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  client = {
    from: vi.fn(() => query),
    rpc: vi.fn(async (name) => ({
      data:
        name === "tc_take_limit"
          ? true
          : name === "tc_state"
            ? { authenticated: false, kiosk: { label: "Front room" } }
            : {},
      error: null,
    })),
  };
  createAdminClient.mockReturnValue(client);
});
it("fails closed with no feature flag or secret", async () => {
  vi.stubEnv("TIME_CLOCK_ENABLED", "false");
  expect(
    (await GET(req("state", {}, { method: "GET" }), ctx("state"))).status,
  ).toBe(503);
  expect(client.rpc).not.toHaveBeenCalled();
  vi.stubEnv("TIME_CLOCK_ENABLED", "true");
  vi.stubEnv("TIME_CLOCK_SECRET", "");
  expect(
    (await POST(req("pair", { code: "12345678" }), ctx("pair"))).status,
  ).toBe(503);
});
it("rejects cross-origin and missing-Origin writes before touching credentials", async () => {
  for (const value of ["https://attacker.test", ""]) {
    expect(
      (
        await POST(
          req("pair", { code: "12345678" }, { origin: value }),
          ctx("pair"),
        )
      ).status,
    ).toBe(403);
  }
  expect(client.rpc).not.toHaveBeenCalled();
});
it("rejects absent device cookie and never looks up a PIN", async () => {
  const r = await POST(
    req("pin", { pin: "123456" }, { headers: { Cookie: "" } }),
    ctx("pin"),
  );
  expect(r.status).toBe(401);
  expect(client.from).not.toHaveBeenCalled();
});
it("verifies the kiosk and applies durable throttling before PIN lookup", async () => {
  client.rpc.mockImplementation(async (name) => ({
    data: name === "tc_take_limit" ? false : {},
    error: null,
  }));
  const r = await POST(req("pin", { pin: "123456" }), ctx("pin"));
  expect(r.status).toBe(429);
  expect(client.from).not.toHaveBeenCalled();
  expect(client.rpc.mock.calls.map((c) => c[0])).toEqual([
    "tc_state",
    "tc_take_limit",
  ]);
});
it("wrong/unknown PIN has a generic response and no session", async () => {
  const r = await POST(req("pin", { pin: "123456" }), ctx("pin"));
  expect(r.status).toBe(401);
  expect((await r.json()).code).toBe("invalid_pin");
  expect(client.rpc.mock.calls.map((c) => c[0])).not.toContain(
    "tc_start_session",
  );
});
it("correct PIN creates an HttpOnly session but returns no verifier or PIN", async () => {
  query.maybeSingle.mockResolvedValue({
    data: {
      id: actor,
      credential_version: requestId,
      pin_verifier: await hashPin("123456", secret),
    },
    error: null,
  });
  const r = await POST(req("pin", { pin: "123456" }), ctx("pin"));
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ ok: true });
  expect(r.headers.get("set-cookie")).toContain("HttpOnly");
  expect(r.headers.get("set-cookie")).toContain("SameSite=strict");
  expect(r.headers.get("cache-control")).toContain("no-store");
});
it("pairing cookie is Secure/Host scoped in production and never returned in JSON", async () => {
  vi.stubEnv("NODE_ENV", "production");
  const r = await POST(req("pair", { code: "12345678" }), ctx("pair"));
  expect(r.status).toBe(200);
  expect(r.headers.get("set-cookie")).toContain("__Host-sdg_tc_device=");
  expect(r.headers.get("set-cookie")).toContain("Secure");
  expect(r.headers.get("set-cookie")).toContain("Path=/");
  expect(await r.json()).toEqual({ kiosk: {} });
});
it("never accepts browser identity, rate, pay basis or punch time", async () => {
  const r = await POST(
    req("operation", {
      request_id: requestId,
      action: "clock_in",
      payload: {
        role_id: "bartender",
        worker_id: actor,
        rate_cents: 999999,
        started_at: "2000-01-01",
        pay_basis: "flat",
        p_owner: true,
      },
    }),
    ctx("operation"),
  );
  expect(r.status).toBe(200);
  const args = client.rpc.mock.calls.find((c) => c[0] === "tc_operate")[1];
  expect(args.p_payload).toEqual({ role_id: "bartender" });
  expect(args.p_kiosk_hash).toBe(keyedHash("device", "A".repeat(43), secret));
});
it("validates operation keys and notes before calling the transaction", async () => {
  for (const input of [
    {
      request_id: "bad",
      action: "clock_in",
      payload: { role_id: "bartender" },
    },
    { request_id: requestId, action: "approve", payload: {} },
    {
      request_id: requestId,
      action: "note",
      payload: { shift_id: actor, note: "x".repeat(2001) },
    },
  ])
    expect((await POST(req("operation", input), ctx("operation"))).status).toBe(
      400,
    );
  expect(client.rpc.mock.calls.map((c) => c[0])).not.toContain("tc_operate");
});
it("blocks non-owner and non-MFA access to all owner reads and writes", async () => {
  requireOwnerMfa.mockResolvedValue({
    unauthorized: true,
    reason: "not_owner",
  });
  expect((await ownerGet(req("owner", {}, { method: "GET" }))).status).toBe(
    403,
  );
  expect(
    (
      await ownerPost(
        req("owner", { action: "create_kiosk", payload: { label: "Front" } }),
      )
    ).status,
  ).toBe(403);
  requireOwnerMfa.mockResolvedValue({
    unauthorized: true,
    reason: "mfa_required",
  });
  expect((await ownerGet(req("owner", {}, { method: "GET" }))).status).toBe(
    403,
  );
  expect(client.rpc).not.toHaveBeenCalled();
  expect(client.from).not.toHaveBeenCalled();
});
it("requires correction reason and timezone-qualified input", async () => {
  const base = {
    id: actor,
    version: 2,
    started_at: "2026-09-29T20:00",
    ended_at: "2026-09-30T01:00",
    reason: "Missed clock-out",
  };
  expect(
    (await ownerPost(req("owner", { action: "correct", payload: base })))
      .status,
  ).toBe(400);
  expect(client.rpc).not.toHaveBeenCalled();
});
it("never logs/persists a plaintext owner-created PIN", async () => {
  const r = await ownerPost(
    req("owner", {
      action: "save_worker",
      payload: {
        name: "Staff",
        category: "employee",
        active: true,
        pay_basis: "unset",
        roles: [],
      },
    }),
  );
  const result = await r.json();
  expect(result.pin).toMatch(/^\d{6}$/);
  const p = client.rpc.mock.calls.find((c) => c[0] === "tc_admin")[1].p_payload;
  expect(p.pin_lookup).toHaveLength(64);
  expect(p.pin_verifier).toMatch(/^scrypt-v1:/);
  expect(JSON.stringify(p)).not.toContain(result.pin);
});
it("rejects oversized payloads and does not leak raw database errors", async () => {
  const huge = await POST(
    req("pair", { code: "12345678", ignored: "x".repeat(17000) }),
    ctx("pair"),
  );
  expect(huge.status).toBe(413);
  client.rpc.mockResolvedValue({
    data: null,
    error: { message: "SECRET database connection details", code: "P0001" },
  });
  const response = await GET(req("state", {}, { method: "GET" }), ctx("state"));
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain("SECRET");
});
