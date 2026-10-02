import { randomInt, randomUUID } from "node:crypto";
import {
  handle,
  manager,
  body,
  db,
  rpc,
  json,
  ClockError,
} from "@/lib/time-clock/server";
import { UUID } from "@/lib/time-clock/core.mjs";
import {
  normalizeEmployeeUsername,
  employeeAuthEmail,
  isInternalEmployeeEmail,
} from "@/lib/time-clock/employee.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BANNED = "876000h";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
function generatedPassword() {
  const pick = () =>
    Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `${pick()}-${pick()}-${pick()}`;
}
function chosenPassword(value) {
  if (value === undefined || value === null || value === "") return generatedPassword();
  if (typeof value !== "string" || value.length < 10 || value.length > 72)
    throw new ClockError("Passwords must be 10–72 characters, or leave blank to generate one.");
  return value;
}
async function workerRow(client, id) {
  if (!UUID.test(id ?? "")) throw new ClockError("Invalid staff profile.");
  const { data, error } = await client
    .from("tc_workers")
    .select("id,name,active,user_id,username,login_enabled,login_managed")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new ClockError("Timekeeping is temporarily unavailable.", 503);
  if (!data) throw new ClockError("Worker not found.", 404);
  return data;
}

// Employee portal logins. Manager-only (Adam/Jeyu + MFA policy). Creates or
// links a Supabase Auth user that can sign in to /employee and see ONLY its
// own linked schedule, hours and pay. No team_members row is ever created.
export async function POST(request) {
  return handle(async () => {
    const actor = await manager(request, true),
      input = await body(request),
      p = input.payload || {},
      client = db();
    const w = await workerRow(client, p.worker_id);
    const audit = (action, payload = {}) =>
      rpc(client, "tc_login_admin", {
        p_actor: actor.id,
        p_action: action,
        p_payload: { worker_id: w.id, ...payload },
      });

    if (input.action === "create") {
      if (w.user_id) throw new ClockError("This profile already has an employee login.", 409);
      const username =
        p.username === undefined || p.username === "" ? null : normalizeEmployeeUsername(p.username);
      if (p.username && !username)
        throw new ClockError(
          "Usernames are 3–32 characters: lowercase letters, numbers, dots, dashes or underscores.",
        );
      const email =
        typeof p.email === "string" && p.email.trim() ? p.email.trim().toLowerCase() : null;
      if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || isInternalEmployeeEmail(email)))
        throw new ClockError("Enter a valid email address.");
      if (!username && !email) throw new ClockError("Enter a username, an email, or both.");
      if (username) {
        const { data: taken, error } = await client
          .from("tc_workers").select("id").eq("username", username).maybeSingle();
        if (error) throw new ClockError("Timekeeping is temporarily unavailable.", 503);
        if (taken) throw new ClockError("That username is already in use.", 409);
      }
      if (email) {
        const existing = await rpc(client, "tc_auth_user_by_email", { p_email: email });
        if (existing?.id) {
          if (existing.station)
            throw new ClockError("That email belongs to a shared station account.", 409);
          await audit("link_login", { user_id: existing.id, username, managed: false });
          return json({
            linked_existing: true,
            text: `${email} already has a Stardust Garage account. It is now linked to ${w.name}. They sign in with their existing password (or use Forgot password on the login page).`,
          });
        }
      }
      const password = chosenPassword(p.password);
      const { data: created, error: createError } = await client.auth.admin.createUser({
        email: email || employeeAuthEmail(randomUUID()),
        password,
        email_confirm: true,
        app_metadata: { employee_account: true },
        user_metadata: { full_name: w.name },
      });
      if (createError || !created?.user?.id)
        throw new ClockError("Could not create the login. No account was saved. Try again.", 503);
      try {
        await audit("link_login", { user_id: created.user.id, username, managed: true });
      } catch (e) {
        await client.auth.admin.deleteUser(created.user.id).catch(() => {});
        throw e;
      }
      return json({ password, username, email });
    }

    if (input.action === "reset_password") {
      if (!w.user_id || !w.login_managed)
        throw new ClockError(
          "Only logins created here can be reset here. Linked accounts use Forgot password.",
          409,
        );
      const password = chosenPassword(p.password);
      const { error } = await client.auth.admin.updateUserById(w.user_id, { password });
      if (error) throw new ClockError("Could not reset the password. Try again.", 503);
      await audit("password_reset");
      return json({ password });
    }

    if (input.action === "set_enabled") {
      if (typeof p.enabled !== "boolean") throw new ClockError("Invalid setting.");
      if (!w.user_id) throw new ClockError("This profile has no employee login.", 409);
      if (w.login_managed) {
        const { error } = await client.auth.admin.updateUserById(w.user_id, {
          ban_duration: p.enabled ? "none" : BANNED,
        });
        if (error) throw new ClockError("Could not update the login. Try again.", 503);
      }
      await audit("set_login_enabled", { enabled: p.enabled });
      return json({ ok: true });
    }

    if (input.action === "remove") {
      if (!w.user_id) throw new ClockError("This profile has no employee login.", 409);
      if (w.login_managed) {
        const { error } = await client.auth.admin.updateUserById(w.user_id, { ban_duration: BANNED });
        if (error) throw new ClockError("Could not remove the login. Try again.", 503);
      }
      await audit("unlink_login");
      return json({ ok: true });
    }
    throw new ClockError("Invalid action.");
  });
}
