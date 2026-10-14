import { getRequestUser } from "@/lib/auth-helpers";
import {
  handle, db, rpc, json, body, assertEnabled, employeeWriteGuard, limit, hash, ClockError,
} from "@/lib/time-clock/server";
import { hashPin } from "@/lib/time-clock/crypto.mjs";
import { pinProblem, birthdateProblem } from "@/lib/time-clock/profile.mjs";
import { chicagoYmd } from "@/lib/time-clock/periods.mjs";
import { validStaffPhoto, uploadStaffPhoto, removeStaffPhoto } from "@/lib/time-clock/invites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function linkedWorker(client, userId) {
  const { data, error } = await client
    .from("tc_workers").select("id").eq("user_id", userId).eq("active", true).eq("login_enabled", true).maybeSingle();
  if (error) throw new ClockError("Staff tools are temporarily unavailable.", 503);
  if (!data)
    throw new ClockError(
      "This account is not linked to an active staff profile. Ask a manager to enable your employee login.",
      403,
      "not_employee",
    );
  return data;
}

// Signed-in employee self-service on their OWN linked profile only:
//  - multipart/form-data: add a missing birthday and/or private photo
//  - JSON { action: "set_pin", pin, pin_confirm }: choose a new iPad PIN
export async function POST(request) {
  return handle(async () => {
    employeeWriteGuard(request);
    assertEnabled();
    const user = await getRequestUser(request);
    if (!user) throw new ClockError("Sign in again to continue.", 401, "not_signed_in");
    const client = db();
    await limit(client, `employee-profile:${user.id}`, 20, 900);
    const worker = await linkedWorker(client, user.id);

    if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) {
      const input = await body(request);
      if (input.action !== "set_pin") throw new ClockError("Invalid action.");
      const problem = pinProblem(input.pin, input.pin_confirm);
      if (problem) throw new ClockError(problem);
      await rpc(client, "tc_employee_profile", {
        p_user: user.id,
        p_action: "set_pin",
        p_payload: {
          pin_lookup: hash("pin-lookup", input.pin),
          pin_verifier: await hashPin(input.pin, process.env.TIME_CLOCK_SECRET),
        },
      });
      return json({ ok: true, text: "New PIN saved. Use it on the iPad from now on." });
    }

    let form;
    try {
      form = await request.formData();
    } catch {
      throw new ClockError("Something went wrong sending the form. Try again.");
    }
    const birthdate = typeof form.get("birthdate") === "string" ? form.get("birthdate") : "";
    if (birthdate) {
      const problem = birthdateProblem(birthdate, chicagoYmd());
      if (problem) throw new ClockError(problem);
    }
    const file = form.get("photo");
    const photo = file && typeof file !== "string" && file.size ? validStaffPhoto(file) : null;
    if (!birthdate && !photo) throw new ClockError("Add your birthday and a photo of yourself to finish.");
    const photoPath = photo ? await uploadStaffPhoto(client, worker.id, photo) : null;
    let result;
    try {
      result = await rpc(client, "tc_employee_profile", {
        p_user: user.id,
        p_action: "complete",
        p_payload: { birthdate: birthdate || null, photo_path: photoPath },
      });
    } catch (e) {
      await removeStaffPhoto(client, photoPath);
      throw e;
    }
    if (result?.replaced_photo) await removeStaffPhoto(client, result.replaced_photo);
    return json({ ok: true, text: "Profile saved." });
  });
}
