// Supabase Edge Function: chat-notify
//
// Called by the web/mobile client immediately after a chat message is
// successfully inserted into `chat_messages`. Sends Expo push notifications
// to every OTHER member of the channel who has a registered push token.
//
// v3 adds mention-aware fan-out. A message that names someone produces TWO
// distinct notification populations:
//
//   1. Mentioned members get a mention push — "Adam mentioned you", type
//      "chat_mention". This is the notification a bartender should feel free to
//      leave sound on for.
//   2. Everyone else gets the ordinary message push, exactly as before.
//
// A mentioned member is deliberately EXCLUDED from the ordinary fan-out, so a
// single message never lands twice on the same phone. The two are separate
// `type` values rather than one push with a flag, so the mobile app can give
// them different channels, sounds and badge behaviour without inspecting the
// payload.
//
// Security model:
//   - verify_jwt is ON, so the caller must present a valid Supabase user JWT
//     (their own session token — never a service key).
//   - We first create a Supabase client scoped to the CALLER's JWT and use it
//     to confirm the message exists and that the caller is the sender. Row
//     Level Security on chat_messages means this lookup only succeeds if the
//     caller is actually a member of that channel — so a user can never
//     trigger notifications for a channel they don't belong to.
//   - Only after that check do we switch to the service-role client to look
//     up the other members' push tokens (their tokens are private data
//     protected by RLS from other users, but this function runs server-side
//     and only echoes a notification, never the raw token, back to anyone).
//   - `mentioned_user_ids` is trusted here only as far as it is intersected
//     with actual channel membership below. The column is itself recomputed
//     server-side by the chat_messages_flatten_entities trigger under the
//     sender's own privileges, so a client cannot inject a mention of someone
//     it could not see — but intersecting again costs nothing and means a
//     future change to that trigger cannot turn into a notification leak.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405 });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) {
    return new Response(JSON.stringify({ error: "missing_authorization" }), { status: 401 });
  }

  let body: { message_id?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400 });
  }

  const messageId = body.message_id;
  if (!messageId) {
    return new Response(JSON.stringify({ error: "message_id_required" }), { status: 400 });
  }

  // Caller-scoped client: RLS enforces that this only returns a row if the
  // authenticated caller is a member of the message's channel.
  const callerClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

  const { data: message, error: messageError } = await callerClient
    .from("chat_messages")
    .select("id, channel_id, sender_id, body, image_path, mentioned_user_ids")
    .eq("id", messageId)
    .single();

  if (messageError || !message) {
    return new Response(JSON.stringify({ error: "message_not_found_or_forbidden" }), { status: 403 });
  }

  const { data: caller } = await callerClient.auth.getUser();
  if (!caller?.user || caller.user.id !== message.sender_id) {
    return new Response(JSON.stringify({ error: "only_sender_can_trigger_notification" }), { status: 403 });
  }

  // Service-role client for the privileged fan-out lookup only.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const [{ data: channel }, { data: members }, { data: senderProfile }] = await Promise.all([
    admin.from("chat_channels").select("id, type, name").eq("id", message.channel_id).single(),
    admin
      .from("chat_channel_members")
      .select("user_id")
      .eq("channel_id", message.channel_id)
      .neq("user_id", message.sender_id),
    admin.from("team_members").select("full_name, email").eq("user_id", message.sender_id).maybeSingle(),
  ]);

  const recipientIds = (members ?? []).map((m) => m.user_id);
  if (recipientIds.length === 0) {
    return new Response(JSON.stringify({ ok: true, sent: 0, mentioned: 0 }), { status: 200 });
  }

  // Mentions that survive the membership intersection. Anyone named but not in
  // the channel simply gets nothing — no error, since a stale mention is not a
  // failure worth rejecting a whole notification over.
  const recipientSet = new Set(recipientIds);
  const mentionedSet = new Set(
    ((message.mentioned_user_ids ?? []) as string[]).filter((id) => recipientSet.has(id)),
  );

  const { data: tokens } = await admin
    .from("push_tokens")
    .select("token, platform, user_id")
    .in("user_id", recipientIds);

  if (!tokens || tokens.length === 0) {
    return new Response(JSON.stringify({ ok: true, sent: 0, mentioned: 0 }), { status: 200 });
  }

  const senderName = senderProfile?.full_name || senderProfile?.email || "A teammate";
  const isDm = channel?.type === "dm";
  const channelLabel = isDm ? senderName : `#${channel?.name ?? "chat"}`;
  const title = isDm ? senderName : channelLabel;

  // Image-only messages have an empty body (allowed since the
  // chat_message_images_and_replies migration relaxed the body check), so
  // fall back to a "📷 Photo" preview instead of showing a blank push.
  const trimmedBody = (message.body ?? "").trim();
  const preview = trimmedBody
    ? (trimmedBody.length > 140 ? `${trimmedBody.slice(0, 137)}...` : trimmedBody)
    : (message.image_path ? "📷 Photo" : "");

  const ordinaryBody = isDm ? preview : `${senderName}: ${preview}`;

  // A mention push says who and where up front, because the reason it is
  // interrupting you is that it is specifically about you.
  const mentionTitle = `${senderName} mentioned you`;
  const mentionBody = isDm ? preview : `${channelLabel} · ${preview}`;

  let mentionCount = 0;
  const expoMessages = tokens
    .filter((t) => t.token?.startsWith("ExponentPushToken"))
    .map((t) => {
      const mentioned = mentionedSet.has(t.user_id);
      if (mentioned) mentionCount += 1;
      return {
        to: t.token,
        sound: "default",
        title: mentioned ? mentionTitle : title,
        body: mentioned ? mentionBody : ordinaryBody,
        data: {
          channelId: message.channel_id,
          messageId: message.id,
          // The two notification kinds the app switches on. Deep-link target is
          // the same in both cases: /team/chat?c=<channelId>&m=<messageId>.
          type: mentioned ? "chat_mention" : "chat_message",
        },
      };
    });

  if (expoMessages.length > 0) {
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(expoMessages),
    });
  }

  return new Response(
    JSON.stringify({ ok: true, sent: expoMessages.length, mentioned: mentionCount }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
