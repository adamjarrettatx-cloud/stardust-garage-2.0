import { createAdminClient } from "@/lib/supabase/admin";
import { enabled } from "@/lib/time-clock/server";
import { INVITE_TOKEN, inviteHash } from "@/lib/time-clock/invites";
import { suggestUsername } from "@/lib/time-clock/profile.mjs";
import EmployeeSetup from "./EmployeeSetup";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Set up your account | Stardust Garage",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

// Opened from a staff invite or PIN-reset email. The token is checked here
// only to show who the link is for; /api/employee/setup re-checks everything.
export default async function EmployeeSetupPage({ searchParams }) {
  const token = (await searchParams)?.token;
  let invite = null;
  let existingAccount = false;
  if (enabled() && typeof token === "string" && INVITE_TOKEN.test(token)) {
    try {
      const client = createAdminClient();
      const { data } = await client.rpc("tc_invite_peek", { p_token_hash: inviteHash(token) });
      invite = data || null;
      if (invite?.kind === "setup") {
        const { data: existing } = await client.rpc("tc_auth_user_by_email", { p_email: invite.email });
        existingAccount = Boolean(existing?.id);
      }
    } catch {
      invite = null;
    }
  }
  return (
    <EmployeeSetup
      token={invite ? token : null}
      invite={
        invite && {
          kind: invite.kind,
          name: invite.name,
          email: invite.email,
          roles: invite.roles || [],
          username: suggestUsername(invite.name),
          existingAccount,
        }
      }
    />
  );
}
