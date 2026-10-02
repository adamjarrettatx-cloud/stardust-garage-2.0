import {
  handle,
  assertEnabled,
  sameOrigin,
  body,
  credentials,
  db,
  rpc,
  limit,
  state,
  hash,
  json,
  setCookie,
  deviceCookie,
  sessionCookie,
  ClockError,
} from "@/lib/time-clock/server";
import { token, verifyPin } from "@/lib/time-clock/crypto.mjs";
import { UUID } from "@/lib/time-clock/core.mjs";
import { isValidPin } from "@/lib/time-clock/pin.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  return handle(async () => {
    const { action } = await params;
    if (action !== "state") throw new ClockError("Not found.", 404);
    return json(await state(request));
  });
}
export async function POST(request, { params }) {
  return handle(async () => {
    sameOrigin(request);
    assertEnabled();
    const { action } = await params;
    const input = await body(request),
      client = db();
    if (action === "pair") {
      await limit(client, "pair:global", 100, 60);
      const ip =
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        "unknown";
      await limit(client, `pair:${ip}`, 10, 900);
      if (!/^\d{8}$/.test(input.code ?? ""))
        throw new ClockError("Enter the eight-digit pairing code.");
      const raw = token();
      const result = await rpc(client, "tc_pair", {
        p_pair_hash: hash("pair", input.code),
        p_token_hash: hash("device", raw),
      });
      const response = json({ kiosk: result });
      setCookie(response, deviceCookie(), raw, 90 * 86400);
      setCookie(response, sessionCookie(), "", 0);
      return response;
    }
    const c = credentials(request);
    if (action === "pin") {
      // Verify the device before consuming a PIN lookup or running the KDF.
      await state(request);
      await limit(client, `pin:${c.device}`, 10, 60);
      if (!isValidPin(input.pin))
        throw new ClockError("Enter your four-digit PIN.");
      const { data: worker, error } = await client
        .from("tc_workers")
        .select("id,pin_verifier,credential_version")
        .eq("pin_lookup", hash("pin-lookup", input.pin))
        .eq("active", true)
        .maybeSingle();
      if (error)
        throw new ClockError("Timekeeping is temporarily unavailable.", 503);
      const valid = await verifyPin(
        input.pin,
        worker?.pin_verifier,
        process.env.TIME_CLOCK_SECRET,
      );
      if (!valid || !worker)
        throw new ClockError(
          "PIN not recognized. Try again or ask the owner.",
          401,
          "invalid_pin",
        );
      const raw = token();
      await rpc(client, "tc_start_session", {
        p_kiosk_hash: c.device,
        p_worker: worker.id,
        p_version: worker.credential_version,
        p_session_hash: hash("session", raw),
      });
      const response = json({ ok: true });
      setCookie(response, sessionCookie(), raw, 900);
      return response;
    }
    if (action === "lock") {
      await rpc(client, "tc_lock", {
        p_kiosk_hash: c.device,
        p_session_hash: c.session,
      });
      const response = json({ ok: true });
      setCookie(response, sessionCookie(), "", 0);
      return response;
    }
    if (action === "touch") return json(await state(request, true));
    if (action !== "operation") throw new ClockError("Not found.", 404);
    await limit(client, `operations:${c.device}`, 120, 60);
    if (!UUID.test(input.request_id ?? ""))
      throw new ClockError("A valid request ID is required.");
    if (
      ![
        "clock_in",
        "clock_out",
        "switch_role",
        "break_start",
        "break_end",
        "task",
        "note",
      ].includes(input.action)
    )
      throw new ClockError("Invalid action.");
    const p = input.payload;
    if (!p || typeof p !== "object" || Array.isArray(p))
      throw new ClockError("Invalid payload.");
    // Explicit allowlist: never forward caller-selected identity/rates/time.
    const payload = {};
    if (input.action !== "clock_in") {
      if (!UUID.test(p.shift_id ?? ""))
        throw new ClockError("A shift ID is required.");
      payload.shift_id = p.shift_id;
    }
    if (["clock_in", "switch_role"].includes(input.action)) {
      if (!/^[a-z_]{2,40}$/.test(p.role_id ?? ""))
        throw new ClockError("Choose a role.");
      payload.role_id = p.role_id;
    }
    if (["clock_out", "note"].includes(input.action)) {
      if (typeof p.note !== "string" || p.note.length > 2000)
        throw new ClockError("Notes must be 2,000 characters or less.");
      payload.note = p.note;
    }
    if (input.action === "task") {
      if (!UUID.test(p.task_id ?? "") || typeof p.done !== "boolean")
        throw new ClockError("Invalid task.");
      payload.task_id = p.task_id;
      payload.done = p.done;
    }
    return json(
      await rpc(client, "tc_operate", {
        p_kiosk_hash: c.device,
        p_session_hash: c.session,
        p_request: input.request_id,
        p_action: input.action,
        p_payload: payload,
      }),
    );
  });
}
