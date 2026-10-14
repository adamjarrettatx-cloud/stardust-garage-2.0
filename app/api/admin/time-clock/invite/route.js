import { handle, manager, body, db, rpc, json, ClockError } from "@/lib/time-clock/server";
import { UUID } from "@/lib/time-clock/core.mjs";
import { isInternalEmployeeEmail } from "@/lib/time-clock/employee.mjs";
import { newInviteToken, inviteHash, setupUrl } from "@/lib/time-clock/invites";
import { sendStaffInvite } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function cleanEmail(value) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!EMAIL.test(email) || email.length > 254 || isInternalEmployeeEmail(email))
    throw new ClockError("Enter a valid email address.");
  return email;
}
async function worker(client, id) {
  if (!UUID.test(id ?? "")) throw new ClockError("Invalid staff profile.");
  const { data, error } = await client
    .from("tc_workers").select("id,name,active,user_id").eq("id", id).maybeSingle();
  if (error) throw new ClockError("Staff tools are temporarily unavailable.", 503);
  if (!data) throw new ClockError("Worker not found.", 404);
  return data;
}
async function openInvite(client, workerId, kind) {
  const { data, error } = await client
    .from("tc_invites").select("email,expires_at,created_at")
    .eq("worker_id", workerId).eq("kind", kind).is("used_at", null).is("revoked_at", null)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new ClockError("Staff tools are temporarily unavailable.", 503);
  return data;
}

// Manager-only (Adam/Jeyu + MFA). Sends, resends and cancels staff email
// invites, and sends PIN-reset links to staff who already have an email
// login. Only a keyed hash of each link token is stored.
export async function POST(request) {
  return handle(async () => {
    const actor = await manager(request, true),
      input = await body(request),
      p = input.payload || {},
      client = db();
    const w = await worker(client, p.worker_id);

    async function issue(kind, email) {
      const token = newInviteToken();
      const created = await rpc(client, "tc_invite_admin", {
        p_actor: actor.id,
        p_action: "create",
        p_payload: { worker_id: w.id, kind, email, token_hash: inviteHash(token) },
      });
      try {
        await sendStaffInvite({ email, fullName: w.name, setupUrl: setupUrl(request, token), kind });
      } catch {
        await rpc(client, "tc_invite_admin", {
          p_actor: actor.id, p_action: "revoke", p_payload: { worker_id: w.id, kind },
        }).catch(() => {});
        throw new ClockError("The email could not be sent, so the invite was cancelled. Check the address and try again.", 502);
      }
      return created;
    }

    if (input.action === "send" || input.action === "resend") {
      if (w.user_id) throw new ClockError("This profile already has an employee login.", 409);
      let email;
      if (input.action === "resend") {
        const open = await openInvite(client, w.id, "setup");
        if (!open) throw new ClockError("There is no open invite to resend. Send a new one.", 409);
        email = open.email;
      } else email = cleanEmail(p.email);
      // Same account rules as manual login creation: shared station, team
      // and partner identities can never become employee-only.
      const existing = await rpc(client, "tc_auth_user_by_email", { p_email: email });
      if (existing?.station) throw new ClockError("That email belongs to a shared station account.", 409);
      if (existing?.team || existing?.partner)
        throw new ClockError(
          "That email belongs to a team or partner account. Create a username login for this person instead.",
          409,
        );
      const created = await issue("setup", email);
      return json({ ok: true, email, expires_at: created.expires_at,
        text: `Invite sent to ${email}. The link expires in 72 hours.` });
    }

    if (input.action === "cancel") {
      await rpc(client, "tc_invite_admin", {
        p_actor: actor.id, p_action: "revoke", p_payload: { worker_id: w.id, kind: "setup" },
      });
      return json({ ok: true, text: `Invite cancelled for ${w.name}.` });
    }

    if (input.action === "pin_reset") {
      if (!w.user_id) throw new ClockError("This profile has no employee login. Use Set PIN manually.", 409);
      const { data } = await client.auth.admin.getUserById(w.user_id).catch(() => ({}));
      const email = data?.user?.email;
      if (!email || isInternalEmployeeEmail(email))
        throw new ClockError("This person has no email on file. Use Set PIN manually.", 409);
      await issue("pin", email.toLowerCase());
      return json({ ok: true,
        text: `PIN reset link sent to ${email}. Their current PIN keeps working until they choose a new one.` });
    }
    throw new ClockError("Invalid action.");
  });
}
