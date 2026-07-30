import { NextResponse } from 'next/server';
import { requireChatChannelAdmin } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { validateChannelName } from '@/lib/chat';

export const runtime = 'nodejs';

// POST /api/team/chat/channels — create a group channel and subscribe the whole
// team to it. Owner-only; see requireChatChannelAdmin().
//
// Uses the service-role client because creating a channel is two writes the
// caller is not otherwise permitted to make: the channel row (blocked for
// everyone by the restrictive RLS policy in
// 20260802_team_chat_channel_admin_and_unread.sql) and a membership row per
// teammate. The gate above is the authorization; the RLS policy is the backstop
// for anyone calling PostgREST directly instead of this route.
export async function POST(request) {
  const { unauthorized } = await requireChatChannelAdmin();
  if (unauthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  const { valid, name, error: nameError } = validateChannelName(body.name);
  if (!valid) return NextResponse.json({ error: nameError }, { status: 400 });

  const admin = createAdminClient();

  const { data: existing } = await admin
    .from('chat_channels')
    .select('id')
    .eq('type', 'channel')
    .ilike('name', name)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ error: `#${name} already exists.` }, { status: 409 });
  }

  const { data: channel, error: insertError } = await admin
    .from('chat_channels')
    .insert({ type: 'channel', name })
    .select('id, type, name, is_default, created_at')
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 400 });
  }

  // Every team member joins a new channel — a channel nobody is in would be
  // invisible, including to the owner who just created it.
  const { data: teamMembers } = await admin
    .from('team_members')
    .select('user_id')
    .not('user_id', 'is', null);

  const memberRows = (teamMembers || []).map((m) => ({
    channel_id: channel.id,
    user_id: m.user_id,
  }));

  if (memberRows.length > 0) {
    const { error: memberError } = await admin.from('chat_channel_members').insert(memberRows);
    if (memberError) {
      // Roll the channel back rather than leaving one nobody can see.
      await admin.from('chat_channels').delete().eq('id', channel.id);
      return NextResponse.json({ error: memberError.message }, { status: 400 });
    }
  }

  return NextResponse.json({ channel }, { status: 201 });
}
