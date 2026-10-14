import { createClient } from "@/lib/supabase/server";
import { handle, db, rpc, json, sameOrigin, assertEnabled, limit, hash, ClockError } from "@/lib/time-clock/server";
import { hashPin } from "@/lib/time-clock/crypto.mjs";
import { normalizeEmployeeUsername } from "@/lib/time-clock/employee.mjs";
import { pinProblem, birthdateProblem } from "@/lib/time-clock/profile.mjs";
import { chicagoYmd } from "@/lib/time-clock/periods.mjs";
import {
  INVITE_TOKEN,
  inviteHash,
  validStaffPhoto,
  uploadStaffPhoto,
  removeStaffPhoto,
} from "@/lib/time-clock/invites";
import { STATION_COOKIE } from "@/lib/station-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const text = (form, key) => {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
};

// Redeems a staff invite (kind "setup") or PIN-reset link (kind "pin").
// Public route: the single-use token is the credential. Every step is
// validated before any account is created, and every created account or
// uploaded photo is undone if the final atomic database step fails.
export async function POST(request) {
  return handle(async () => {
    sameOrigin(request);
    assertEnabled();
    const client = db();
    const ip =
      request.headers.get("x-vercel-forwarded-for") || request.headers.get("x-forwarded-for") || "unknown";
    await limit(client, "staff-setup:global", 300, 900);
    await limit(client, `staff-setup:ip:${ip}`, 30, 900);

    let form;
    try {
      form = await request.formData();
    } catch {
      throw new ClockError("Something went wrong sending the form. Try again.");
    }
    const token = text(form, "token");
    if (!INVITE_TOKEN.test(token)) throw new ClockError("This link has expired or was already used. Ask a manager to resend it.", 410, "invite_invalid");
    const tokenHash = inviteHash(token);
    const invite = await rpc(client, "tc_invite_peek", { p_token_hash: tokenHash });
    if (!invite) throw new ClockError("This link has expired or was already used. Ask a manager to resend it.", 410, "invite_invalid");
    // Per-link attempt count (max 20, enforced by tc_invite_peek) limits PIN
    // probing across IPs.
    await rpc(client, "tc_invite_attempt", { p_token_hash: tokenHash });

    const pin = text(form, "pin");
    const pinError = pinProblem(pin, text(form, "pin_confirm"));
    if (pinError) throw new ClockError(pinError);
    const pinLookup = hash("pin-lookup", pin);
    const pinVerifier = await hashPin(pin, process.env.TIME_CLOCK_SECRET);
    const { data: taken, error: takenError } = await client
      .from("tc_workers").select("id").eq("pin_lookup", pinLookup).neq("id", invite.worker_id).maybeSingle();
    if (takenError) throw new ClockError("Setup is temporarily unavailable. Try again.", 503);
    if (taken) throw new ClockError("That PIN can't be used. Choose a different one.", 409, "pin_taken");

    if (invite.kind === "pin") {
      await rpc(client, "tc_invite_redeem", {
        p_token_hash: tokenHash,
        p_payload: { pin_lookup: pinLookup, pin_verifier: pinVerifier },
      });
      return json({ ok: true, text: "Your new PIN works on the iPad now. Your old PIN no longer works." });
    }

    // Account setup.
    const birthdate = text(form, "birthdate");
    const birthError = birthdateProblem(birthdate, chicagoYmd());
    if (birthError) throw new ClockError(birthError);
    const rawUsername = text(form, "username").trim();
    const username = rawUsername ? normalizeEmployeeUsername(rawUsername) : null;
    if (rawUsername && !username)
      throw new ClockError("Usernames are 3–32 characters: lowercase letters, numbers, dots, dashes or underscores.");
    if (username) {
      const { data: other, error } = await client
        .from("tc_workers").select("id").eq("username", username).neq("id", invite.worker_id).maybeSingle();
      if (error) throw new ClockError("Setup is temporarily unavailable. Try again.", 503);
      if (other) throw new ClockError("That username is taken. Choose another.", 409, "username_taken");
    }
    const photo = validStaffPhoto(form.get("photo"));

    const email = invite.email;
    const existing = await rpc(client, "tc_auth_user_by_email", { p_email: email });
    if (existing?.station || existing?.team || existing?.partner)
      throw new ClockError("This email can't be used for a staff login. Ask a manager to send a new invite.", 409);
    let userId = existing?.id || null;
    let created = false;
    let password = null;
    if (!userId) {
      password = text(form, "password");
      if (password.length < 10 || password.length > 72)
        throw new ClockError("Use a password of 10–72 characters.");
    }

    const photoPath = await uploadStaffPhoto(client, invite.worker_id, photo);
    try {
      if (userId) {
        const { error } = await client.auth.admin.updateUserById(userId, { app_metadata: { employee_account: true } });
        if (error) throw new ClockError("Could not link your account. Nothing was changed. Try again.", 503);
      } else {
        // The emailed single-use link proves the address, so it is confirmed.
        const { data, error } = await client.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          app_metadata: { employee_account: true },
          user_metadata: { full_name: invite.name },
        });
        if (error || !data?.user?.id)
          throw new ClockError("Could not create your account. Nothing was saved. Try again.", 503);
        userId = data.user.id;
        created = true;
      }
      await rpc(client, "tc_invite_redeem", {
        p_token_hash: tokenHash,
        p_payload: {
          user_id: userId,
          username,
          managed: created,
          pin_lookup: pinLookup,
          pin_verifier: pinVerifier,
          birthdate,
          photo_path: photoPath,
        },
      });
    } catch (e) {
      await removeStaffPhoto(client, photoPath);
      if (created) await client.auth.admin.deleteUser(userId).catch(() => {});
      else if (userId)
        await client.auth.admin.updateUserById(userId, { app_metadata: { employee_account: false } }).catch(() => {});
      throw e;
    }

    if (!created)
      return json({
        ok: true,
        text: `Your profile is set up. Sign in with ${email} and your existing Stardust Garage password.`,
      });

    // New account: sign straight in and open the employee portal.
    const supabase = await createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError)
      return json({ ok: true, text: `Your account is ready. Sign in with ${username || email} and your new password.` });
    const response = json({ ok: true, destination: "/employee" });
    if (request.cookies?.get(STATION_COOKIE))
      response.cookies.set(STATION_COOKIE, "", { path: "/", maxAge: 0, secure: true });
    return response;
  });
}
