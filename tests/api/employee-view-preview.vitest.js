import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/auth-helpers", () => ({
  requireAdminMfa: vi.fn(),
  adminPageGate: vi.fn(),
  getRequestUser: vi.fn(),
}));
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminMfa } from "@/lib/auth-helpers";
import { GET } from "../../app/api/admin/time-clock/employee-preview/route.js";

const origin = "https://www.sdgatx.com";
const worker = "55555555-5555-4555-8555-555555555555";
const url = (q) => new Request(`${origin}/api/admin/time-clock/employee-preview?${q}`);
const range = "from=2026-10-12&to=2026-10-18";
let client;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TIME_CLOCK_ENABLED", "true");
  vi.stubEnv("TIME_CLOCK_SECRET", "test-only-time-clock-secret-".repeat(3));
  requireAdminMfa.mockResolvedValue({ user: { id: "11111111-1111-4111-8111-111111111111", email: "adam@sdgatx.com" }, isAdmin: true, unauthorized: false });
  client = { rpc: vi.fn(async () => ({ data: { worker: { id: worker, name: "Sam" }, preview: { has_login: false } }, error: null })) };
  createAdminClient.mockReturnValue(client);
});

it("returns the employee payload for a manager, by staff profile id", async () => {
  const res = await GET(url(`worker=${worker}&${range}`));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.worker.name).toBe("Sam");
  expect(body.preview.has_login).toBe(false);
  const [name, args] = client.rpc.mock.calls[0];
  expect(name).toBe("tc_employee_preview");
  expect(args.p_worker).toBe(worker);
});

it("refuses anyone who is not a timekeeping manager", async () => {
  requireAdminMfa.mockResolvedValue({ unauthorized: true, reason: "not_admin" });
  expect((await GET(url(`worker=${worker}&${range}`))).status).toBe(403);
  requireAdminMfa.mockResolvedValue({ user: { id: "22222222-2222-4222-8222-222222222222", email: "someone@sdgatx.com" }, isAdmin: true, unauthorized: false });
  expect((await GET(url(`worker=${worker}&${range}`))).status).toBe(403);
  expect(client.rpc).not.toHaveBeenCalled();
});

it("rejects a bad staff id and reports inactive profiles as not found", async () => {
  expect((await GET(url(`worker=not-a-uuid&${range}`))).status).toBe(400);
  client.rpc.mockResolvedValueOnce({ data: null, error: null });
  expect((await GET(url(`worker=${worker}&${range}`))).status).toBe(404);
});
