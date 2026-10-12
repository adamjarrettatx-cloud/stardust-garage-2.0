import { test } from "node:test";
import assert from "node:assert/strict";
import {
  employeeAllowedPath,
  employeeLockdown,
  isEmployeeOnlyRequest,
  sessionAccessToken,
} from "../lib/employee-lockdown.js";

const b64url = (s) => Buffer.from(s).toString("base64url");
const jwt = (claims) => `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify(claims))}.sig`;
const employeeToken = jwt({ sub: "u1", app_metadata: { employee_account: true } });
const customerToken = jwt({ sub: "u2", app_metadata: { provider: "email" } });

function req(pathname, { cookies = [], auth } = {}) {
  const url = new URL(`https://sdgatx.com${pathname}`);
  return {
    headers: new Headers(auth ? { authorization: auth } : {}),
    cookies: { getAll: () => cookies },
    nextUrl: { pathname: url.pathname, clone: () => new URL(url) },
  };
}
const NextResponse = {
  json: (body, init) => ({ kind: "json", body, status: init.status }),
  redirect: (url) => ({ kind: "redirect", location: url.pathname }),
};
const sessionCookie = (token, { chunk = false, base64 = false } = {}) => {
  let value = JSON.stringify({ access_token: token, refresh_token: "r" });
  if (base64) value = "base64-" + b64url(value);
  if (!chunk) return [{ name: "sb-abc-auth-token", value }];
  const mid = Math.floor(value.length / 2);
  return [
    { name: "sb-abc-auth-token.1", value: value.slice(mid) },
    { name: "sb-abc-auth-token.0", value: value.slice(0, mid) },
  ];
};

test("reads plain, chunked and base64 Supabase session cookies", () => {
  assert.equal(sessionAccessToken(sessionCookie(employeeToken)), employeeToken);
  assert.equal(sessionAccessToken(sessionCookie(employeeToken, { chunk: true })), employeeToken);
  assert.equal(sessionAccessToken(sessionCookie(employeeToken, { chunk: true, base64: true })), employeeToken);
  assert.equal(sessionAccessToken([{ name: "other", value: "x" }]), null);
});

test("employee sessions are redirected from every other page", () => {
  for (const path of ["/", "/home", "/events", "/member", "/account/profile", "/bananas", "/team/calendar", "/capacity/front-desk", "/portal"]) {
    const r = employeeLockdown(req(path, { cookies: sessionCookie(employeeToken) }), NextResponse);
    assert.deepEqual(r, { kind: "redirect", location: "/employee" }, path);
  }
});

test("employee sessions get 403 from every other API, including bearer calls from the app", () => {
  for (const path of ["/api/account/profile", "/api/tickets/checkout", "/api/team/tasks", "/api/admin/time-clock"]) {
    const viaCookie = employeeLockdown(req(path, { cookies: sessionCookie(employeeToken) }), NextResponse);
    const viaBearer = employeeLockdown(req(path, { auth: `Bearer ${employeeToken}` }), NextResponse);
    assert.equal(viaCookie.status, 403, path);
    assert.equal(viaBearer.status, 403, path);
  }
});

test("employee portal, sign-in, recovery and assets stay reachable", () => {
  for (const path of ["/employee", "/employee/login", "/api/employee/me", "/api/employee/requests", "/login", "/auth/callback", "/reset-password", "/privacy", "/clock", "/logos/wordmark-white.svg", "/_next/data/x.json"]) {
    assert.equal(employeeAllowedPath(path), true, path);
    assert.equal(employeeLockdown(req(path, { cookies: sessionCookie(employeeToken) }), NextResponse), null, path);
  }
});

test("customers, signed-out visitors and malformed tokens are unaffected", () => {
  assert.equal(isEmployeeOnlyRequest(req("/member", { cookies: sessionCookie(customerToken) })), false);
  assert.equal(isEmployeeOnlyRequest(req("/member")), false);
  assert.equal(isEmployeeOnlyRequest(req("/member", { auth: "Bearer not.a.jwt" })), false);
  assert.equal(employeeLockdown(req("/member", { cookies: sessionCookie(customerToken) }), NextResponse), null);
});
