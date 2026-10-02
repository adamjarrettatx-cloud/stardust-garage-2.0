import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/auth-helpers", () => ({
  requireAdminMfa: vi.fn(),
  adminPageGate: vi.fn(),
}));
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminMfa, adminPageGate } from "@/lib/auth-helpers";
import { timekeepingPageGate } from "../../lib/time-clock/auth.js";
import { GET, POST } from "../../app/api/time-clock/[action]/route.js";
import {
  GET as ownerGet,
  POST as ownerPost,
} from "../../app/api/admin/time-clock/route.js";
import { keyedHash, hashPin, verifyPin } from "../../lib/time-clock/crypto.mjs";

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
  requireAdminMfa.mockResolvedValue({
    user: { id: actor, email: "adam@sdgatx.com" },
    isAdmin: true,
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
    req("pin", { pin: "1234" }, { headers: { Cookie: "" } }),
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
  const r = await POST(req("pin", { pin: "1234" }), ctx("pin"));
  expect(r.status).toBe(429);
  expect(client.from).not.toHaveBeenCalled();
  expect(client.rpc.mock.calls.map((c) => c[0])).toEqual([
    "tc_state",
    "tc_take_limit",
  ]);
});
it("wrong/unknown PIN has a generic response and no session", async () => {
  const r = await POST(req("pin", { pin: "1234" }), ctx("pin"));
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
      pin_verifier: await hashPin("1234", secret),
    },
    error: null,
  });
  const r = await POST(req("pin", { pin: "1234" }), ctx("pin"));
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
it("blocks non-admin and non-MFA access to management reads and writes", async () => {
  requireAdminMfa.mockResolvedValue({
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
  requireAdminMfa.mockResolvedValue({
    unauthorized: true,
    reason: "mfa_required",
  });
  expect((await ownerGet(req("owner", {}, { method: "GET" }))).status).toBe(
    403,
  );
  expect(client.rpc).not.toHaveBeenCalled();
  expect(client.from).not.toHaveBeenCalled();
});
it.each(["adam@sdgatx.com", "jeyu@sdgatx.com"])(
  "allows verified admin %s to manage staff",
  async (email) => {
    requireAdminMfa.mockResolvedValue({
      user: { id: actor, email },
      isAdmin: true,
      unauthorized: false,
    });
    const r = await ownerPost(
      req("owner", { action: "reset_pin", payload: { id: actor } }),
    );
    expect(r.status).toBe(200);
    expect(
      client.rpc.mock.calls.find((c) => c[0] === "tc_admin")[1].p_actor,
    ).toBe(actor);
    adminPageGate.mockResolvedValue({
      user: { id: actor, email },
      isAdmin: true,
      redirect: null,
    });
    expect((await timekeepingPageGate()).redirect).toBeNull();
  },
);
it.each([
  ["other@sdgatx.com", true],
  ["jeyu@sdgatx.com", false],
  ["adam@sdgatx.com", false],
  ["jeyu@sdgatx.com.attacker.test", true],
  [undefined, true],
])("denies unapproved identity or role %s / %s", async (email, isAdmin) => {
  requireAdminMfa.mockResolvedValue({
    user: { id: actor, email },
    isAdmin,
    unauthorized: false,
  });
  expect((await ownerGet(req("owner", {}, { method: "GET" }))).status).toBe(
    403,
  );
  expect(
    (
      await ownerPost(
        req("owner", { action: "reset_pin", payload: { id: actor } }),
      )
    ).status,
  ).toBe(403);
  adminPageGate.mockResolvedValue({
    user: { id: actor, email },
    isAdmin,
    redirect: null,
  });
  expect((await timekeepingPageGate()).redirect).toBe("/bananas");
  expect(client.rpc).not.toHaveBeenCalled();
  expect(client.from).not.toHaveBeenCalled();
});
it("preserves login and MFA redirects from the verified admin gate", async () => {
  for (const redirect of [
    "/login",
    "/member",
    "/bananas/security?mfa=required",
  ]) {
    adminPageGate.mockResolvedValue({ redirect });
    expect((await timekeepingPageGate()).redirect).toBe(redirect);
  }
});
it.each(["save_worker", "reset_pin"])(
  "stores only hashes for chosen PIN in %s",
  async (action) => {
    const payload =
      action === "reset_pin"
        ? { id: actor, pin: "0456" }
        : {
            name: "Test worker",
            category: "contractor",
            active: true,
            pay_basis: "flat",
            flat_cents: 17500,
            roles: [],
            pin: "0456",
          };
    const r = await ownerPost(req("owner", { action, payload }));
    expect(r.status).toBe(200);
    expect((await r.json()).pin).toBe("0456");
    const stored = client.rpc.mock.calls.find((c) => c[0] === "tc_admin")[1]
      .p_payload;
    expect(stored).not.toHaveProperty("pin");
    expect(stored.pin_lookup).toBe(
      keyedHash("pin-lookup", payload.pin, secret),
    );
    expect(await verifyPin(payload.pin, stored.pin_verifier, secret)).toBe(
      true,
    );
  },
);
it.each(["123", "12345", "123456", "1234567", "abcd", "1234\n", " 1234", "１２３４", 1234, null])(
  "rejects malformed chosen PIN %s before writing",
  async (pin) => {
    for (const action of ["reset_pin", "save_worker"]) {
      const payload = action === "reset_pin"
        ? { id: actor, pin }
        : { name: "Test worker", category: "employee", active: true, pay_basis: "unset", roles: [], pin };
      expect((await ownerPost(req("owner", { action, payload }))).status).toBe(400);
    }
    expect(client.rpc).not.toHaveBeenCalled();
  },
);
it.each(["123", "12345", "123456", "1234\n", "abcd", 1234, null])(
  "rejects non-four-digit kiosk PIN %s without a worker lookup",
  async (pin) => {
    expect((await POST(req("pin", { pin }), ctx("pin"))).status).toBe(400);
    expect(client.from).not.toHaveBeenCalled();
    expect(client.rpc.mock.calls.map((c) => c[0])).not.toContain("tc_start_session");
  },
);
it("preserves leading-zero four-digit PIN on login", async () => {
  query.maybeSingle.mockResolvedValue({
    data: { id: actor, credential_version: requestId, pin_verifier: await hashPin("0007", secret) },
    error: null,
  });
  expect((await POST(req("pin", { pin: "0007" }), ctx("pin"))).status).toBe(200);
  expect(query.eq).toHaveBeenCalledWith("pin_lookup", keyedHash("pin-lookup", "0007", secret));
});
it("generates a four-digit replacement PIN when reset is left blank", async () => {
  const r = await ownerPost(req("owner", { action: "reset_pin", payload: { id: actor, pin: "" } }));
  expect(r.status).toBe(200);
  const { pin } = await r.json();
  expect(pin).toMatch(/^[0-9]{4}$/);
  const stored = client.rpc.mock.calls.find((c) => c[0] === "tc_admin")[1].p_payload;
  expect(await verifyPin(pin, stored.pin_verifier, secret)).toBe(true);
});
it("does not disclose a PIN when uniqueness fails", async () => {
  client.rpc.mockResolvedValue({
    error: { code: "23505", message: "private DB details" },
  });
  const r = await ownerPost(
    req("owner", {
      action: "reset_pin",
      payload: { id: actor, pin: "0456" },
    }),
  );
  expect(r.status).toBe(409);
  const result = await r.json();
  expect(result).not.toHaveProperty("pin");
  expect(JSON.stringify(result)).not.toContain("0456");
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
  expect(result.pin).toMatch(/^\d{4}$/);
  const p = client.rpc.mock.calls.find((c) => c[0] === "tc_admin")[1].p_payload;
  expect(p.pin_lookup).toHaveLength(64);
  expect(p.pin_verifier).toMatch(/^scrypt-v1:/);
  expect(p).not.toHaveProperty("pin");
  expect(JSON.stringify(p)).not.toContain(JSON.stringify(result.pin));
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
