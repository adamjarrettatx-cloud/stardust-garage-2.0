// SERVER ONLY. Never import from a Client Component.
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireStaffManager } from "./auth";
import { keyedHash } from "./crypto.mjs";

export class ClockError extends Error {
  constructor(message, status = 400, code = "invalid_request") {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export function enabled() {
  return (
    process.env.TIME_CLOCK_ENABLED === "true" &&
    (process.env.TIME_CLOCK_SECRET?.length ?? 0) >= 43
  );
}
export function assertEnabled() {
  if (!enabled())
    throw new ClockError(
      "Time clock is not enabled yet. Contact the owner.",
      503,
      "not_enabled",
    );
}
export function hash(purpose, value) {
  return keyedHash(purpose, value, process.env.TIME_CLOCK_SECRET);
}
export function db() {
  return createAdminClient();
}
export function sameOrigin(request) {
  const origin = request.headers.get("origin");
  // Require a browser Origin on all writes, including PIN and pairing.
  // Never accept forwarded Host supplied by the requester as the allowlist.
  if (
    !origin ||
    origin !== new URL(request.url).origin ||
    request.headers.get("sec-fetch-site") === "cross-site"
  ) {
    throw new ClockError(
      "This request is not allowed.",
      403,
      "origin_not_allowed",
    );
  }
}
// Employee writes come from the website (cookie session, Origin required) or
// the mobile app (Authorization: Bearer, which browsers never attach on their
// own, so cross-site request forgery does not apply).
export function employeeWriteGuard(request) {
  const auth = request.headers.get("authorization") || "";
  if (/^Bearer\s+\S+$/i.test(auth)) return;
  sameOrigin(request);
}
export async function manager(request, write = false) {
  if (write) sameOrigin(request);
  const auth = await requireStaffManager();
  if (auth.unauthorized) {
    throw new ClockError(
      auth.reason === "mfa_required"
        ? "Multi-factor authentication required."
        : "Staff management access required.",
      403,
      auth.reason || "not_staff_manager",
    );
  }
  assertEnabled();
  return auth.user;
}
export async function body(request) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new ClockError("JSON required.");
  const reader = request.body?.getReader();
  if (!reader) throw new ClockError("Request body required.");
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > 16384) {
        await reader.cancel();
        throw new ClockError("Request too large.", 413);
      }
      chunks.push(value);
    }
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("shape");
    return parsed;
  } catch (e) {
    if (e instanceof ClockError) throw e;
    throw new ClockError("Invalid JSON.");
  }
}
export const deviceCookie = () =>
  process.env.NODE_ENV === "production"
    ? "__Host-sdg_tc_device"
    : "sdg_tc_device";
export const sessionCookie = () =>
  process.env.NODE_ENV === "production"
    ? "__Host-sdg_tc_session"
    : "sdg_tc_session";
function readCookie(request, name) {
  return (
    request.cookies?.get(name)?.value ??
    request.headers
      .get("cookie")
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${name}=`))
      ?.slice(name.length + 1) ??
    ""
  );
}
export function credentials(request) {
  const device = readCookie(request, deviceCookie()),
    session = readCookie(request, sessionCookie());
  if (!/^[A-Za-z0-9_-]{43}$/.test(device))
    throw new ClockError(
      "Pair this iPad before clocking in.",
      401,
      "device_not_authorized",
    );
  return {
    device: hash("device", device),
    session: /^[A-Za-z0-9_-]{43}$/.test(session)
      ? hash("session", session)
      : "",
  };
}
export function setCookie(response, name, value, maxAge) {
  response.cookies.set(name, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge,
  });
}
export function json(data, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
const messages = {
  pin_unchanged: [
    409,
    "Choose a different PIN, or leave it blank to generate a replacement.",
  ],
  device_not_authorized: [
    401,
    "This iPad needs to be paired or its access has expired.",
  ],
  not_authorized: [401, "Your PIN session expired. Enter your PIN again."],
  pairing_invalid: [400, "Pairing code is invalid, expired, or already used."],
  role_not_assigned: [409, "This role is no longer assigned to you."],
  shift_already_open: [
    409,
    "You already have an open shift. Lock the screen and enter your PIN to resume it.",
  ],
  shift_changed: [409, "This shift changed. Refresh before continuing."],
  request_conflict: [
    409,
    "This request conflicts with an earlier action. Refresh the shift.",
  ],
  end_break_first: [409, "End your break before switching roles."],
  same_role: [409, "You are already working this role."],
  break_already_open: [409, "A break is already running."],
  no_open_break: [409, "No break is running."],
  shift_still_open: [
    409,
    "Clock out or correct the missing clock-out before approval.",
  ],
  shift_overlap: [409, "These times overlap another shift for this person."],
  correction_crosses_segment: [
    409,
    "The correction crosses a role change or break. Keep those intervals within the shift.",
  ],
  invalid_time_range: [
    400,
    "Enter valid times, not in the future, with the end after the start.",
  ],
  reason_required: [
    400,
    "A correction reason of at least five characters is required.",
  ],
  worker_not_found: [404, "Worker not found."],
  role_not_found: [409, "That role is not active. Choose another role."],
  invalid_rate: [400, "Enter a valid hourly rate."],
  shift_not_found: [404, "Shift not found."],
  device_not_found: [404, "Device not found."],
  schedule_invalid: [400, "Choose a person, role, start and end for each shift."],
  schedule_invalid_time: [
    400,
    "Enter a valid shift: the end must be after the start and within 24 hours.",
  ],
  schedule_worker_inactive: [409, "That staff member is dismissed."],
  schedule_role_not_assigned: [
    409,
    "That role is not assigned to this person. Add it on their staff profile first.",
  ],
  schedule_overlap: [
    409,
    "This person is already scheduled during part of that time.",
  ],
  schedule_not_found: [404, "That scheduled shift no longer exists. Refresh."],
  schedule_changed: [409, "This scheduled shift changed. Refresh before saving."],
  login_exists: [409, "This profile already has an employee login."],
  login_missing: [409, "This profile does not have a managed employee login."],
  schedule_time_off: [
    409,
    "This person has approved time off then. Revoke the time off under Requests first if they agreed to work.",
  ],
  not_employee: [
    403,
    "This account is not linked to an active staff profile. Ask a manager to enable your employee login.",
  ],
  request_reason_required: [400, "Add a short reason (3–500 characters)."],
  request_invalid_time: [
    400,
    "Check the times: the end must be after the start, worked shifts can be at most 24 hours and cannot be in the future, and time off can be up to 31 days.",
  ],
  request_shift_open: [409, "This shift is still running. Clock out on the iPad first."],
  request_no_change: [400, "Those are already the recorded times."],
  request_duplicate: [409, "You already have a request covering this. Cancel it first to send a new one."],
  request_limit: [429, "You have 20 open requests. Wait for a manager to review them."],
  request_not_pending: [409, "This request has already been decided or cancelled. Refresh."],
  request_not_found: [404, "That request no longer exists. Refresh."],
  request_changed: [409, "This request changed. Refresh before deciding."],
  request_note_required: [400, "Add a short note for the employee (at least 3 characters)."],
  request_note_too_long: [400, "Keep the note under 500 characters."],
  invite_invalid: [410, "This link has expired or was already used. Ask a manager to resend it."],
  invite_not_found: [404, "There is no open invite to cancel."],
  pin_taken: [409, "That PIN can't be used. Choose a different one."],
  pin_invalid: [400, "Your PIN must be exactly four digits."],
  username_taken: [409, "That username is taken. Choose another."],
  account_linked: [409, "That account is already linked to another staff profile. Ask a manager for help."],
  profile_incomplete: [400, "Add your birthday and a photo of yourself to finish."],
};
export async function rpc(client, name, args = {}) {
  const { data, error } = await client.rpc(name, args);
  if (error) {
    const code = Object.keys(messages).find((k) => error.message === k);
    if (code) throw new ClockError(messages[code][1], messages[code][0], code);
    if (error.code === "23505")
      throw new ClockError(
        "Duplicate record or PIN. Refresh and try again.",
        409,
        "duplicate",
      );
    if (["23514", "23503", "22P02", "22007", "22008"].includes(error.code))
      throw new ClockError("Invalid record or time range.", 400);
    // No raw DB errors, credentials, names or notes in responses/logs.
    throw new ClockError(
      "Staff tools are temporarily unavailable. No success has been confirmed. Retry the same action.",
      503,
      "temporarily_unavailable",
    );
  }
  return data;
}
export async function limit(client, key, count, seconds) {
  const allowed = await rpc(client, "tc_take_limit", {
    p_key: hash("limit", key),
    p_limit: count,
    p_seconds: seconds,
  });
  if (!allowed)
    throw new ClockError(
      "Too many attempts. Please wait before trying again.",
      429,
      "rate_limited",
    );
}
export async function state(request, touch = false) {
  assertEnabled();
  const c = credentials(request),
    client = db();
  return rpc(client, "tc_state", {
    p_kiosk_hash: c.device,
    p_session_hash: c.session,
    p_touch: touch,
  });
}
export async function handle(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ClockError)
      return json({ error: e.message, code: e.code }, e.status);
    return json(
      {
        error:
          "Staff tools are temporarily unavailable. No success has been confirmed.",
        code: "temporarily_unavailable",
      },
      503,
    );
  }
}
