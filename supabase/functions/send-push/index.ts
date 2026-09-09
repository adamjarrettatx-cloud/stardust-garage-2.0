// Supabase Edge Function: send-push
//
// Privileged server-side sender for Expo notifications. The legacy
// `user_ids`/`emails` targeting is retained for existing webhook callers;
// new notification-pipeline callers use the explicit `user_id` + `type`
// contract below.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

type PushType =
  | "ticket_purchased"
  | "door_checkin"
  | "trial_approved"
  | "membership_update"
  | "admin_broadcast"
  | "chat_mention";

const PUSH_TYPES: PushType[] = [
  "ticket_purchased",
  "door_checkin",
  "trial_approved",
  "membership_update",
  "admin_broadcast",
  "chat_mention",
];

interface SendPushBody {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  // Unified pipeline contract:
  user_id?: string;
  type?: PushType;
  // Backward-compatible server-to-server targeting:
  user_ids?: string[];
  emails?: string[];
  broadcast?: boolean;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isExpoPushToken(token: string | null | undefined) {
  return Boolean(token && /^(?:Expo|Exponent)PushToken\[.+\]$/.test(token));
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return json({ error: "missing_authorization" }, 401);

  let payload: SendPushBody;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  if (!payload.title || !payload.body) {
    return json({ error: "title_and_body_required" }, 400);
  }
  if (payload.user_id && !payload.type) {
    return json({ error: "type_required_for_user_id" }, 400);
  }
  if (payload.type && !PUSH_TYPES.includes(payload.type)) {
    return json({ error: "invalid_type" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const isServiceRoleCaller = jwt === SERVICE_ROLE_KEY;
  let selfUserId: string | null = null;

  if (!isServiceRoleCaller) {
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: caller, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !caller?.user) return json({ error: "invalid_token" }, 401);
    selfUserId = caller.user.id;

    const requestedIds = [payload.user_id, ...(payload.user_ids ?? [])].filter(Boolean);
    const targetingOthers =
      payload.broadcast === true ||
      Boolean(payload.emails?.length) ||
      requestedIds.some((id) => id !== selfUserId);
    if (targetingOthers) {
      const { data: isAdmin, error } = await callerClient.rpc("is_admin");
      if (error || !isAdmin) return json({ error: "admin_required" }, 403);
    } else if (!requestedIds.length) {
      payload.user_id = selfUserId;
    }
  }

  let recipientIds: string[] = [];
  if (payload.broadcast) {
    const { data, error } = await admin.from("push_tokens").select("user_id");
    if (error) return json({ error: "broadcast_lookup_failed", detail: error.message }, 500);
    recipientIds = (data ?? []).map((row: { user_id: string }) => row.user_id);
  } else {
    if (payload.user_id) recipientIds.push(payload.user_id);
    if (payload.user_ids?.length) recipientIds.push(...payload.user_ids);
    if (payload.emails?.length) {
      const { data, error } = await admin
        .from("member_profiles")
        .select("user_id, email")
        .in("email", payload.emails.map((email) => email.toLowerCase()));
      if (error) return json({ error: "email_lookup_failed", detail: error.message }, 500);
      recipientIds.push(...(data ?? []).map((profile: { user_id: string | null }) => profile.user_id).filter(Boolean) as string[]);
    }
  }

  recipientIds = [...new Set(recipientIds)];
  if (!recipientIds.length) return json({ ok: true, sent: 0, reason: "no_recipients" });

  const { data: tokens, error: tokenError } = await admin
    .from("push_tokens")
    .select("token")
    .in("user_id", recipientIds);
  if (tokenError) return json({ error: "token_fetch_failed", detail: tokenError.message }, 500);

  const expoMessages = (tokens ?? [])
    .filter((token: { token: string }) => isExpoPushToken(token.token))
    .map((token: { token: string }) => ({
      to: token.token,
      title: payload.title,
      body: payload.body,
      data: payload.type ? { ...payload.data, type: payload.type } : (payload.data ?? {}),
      sound: "default",
      priority: "high",
    }));

  let sent = 0;
  const invalidTokens: string[] = [];
  for (let i = 0; i < expoMessages.length; i += 100) {
    const chunk = expoMessages.slice(i, i + 100);
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(chunk),
    });
    if (!response.ok) {
      return json({ error: "expo_send_failed", detail: await response.text() }, 502);
    }
    const result = await response.json();
    sent += chunk.length;
    if (Array.isArray(result.data)) {
      result.data.forEach((ticket: { status?: string; details?: { error?: string } }, index: number) => {
        if (ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered") {
          invalidTokens.push(chunk[index].to);
        }
      });
    }
  }

  if (invalidTokens.length) {
    await admin.from("push_tokens").delete().in("token", invalidTokens);
  }

  return json({ ok: true, sent, recipients: recipientIds.length });
});
