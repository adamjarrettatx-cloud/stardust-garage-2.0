import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/stub';
import { getCurrentUser } from '@/lib/auth-helpers';
import { NOTIFICATION_TYPES, listUserConfigurableTypes, effectiveChannels } from '@/lib/notifications/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/notifications/preferences
//
// Return the full list of user-configurable notification types + the user's
// current effective settings. Types they haven't touched come back with the
// type defaults.
export async function GET(request) {
  const { user } = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const types = listUserConfigurableTypes();
  if (!isSupabaseConfigured()) {
    return NextResponse.json({
      types: types.map((t) => ({
        id: t.id,
        label: t.label,
        description: t.description,
        category: t.category,
        push_available: false,
        channels: effectiveChannels(t.id, null),
      })),
    });
  }

  const admin = createAdminClient();
  const { data: prefs, error } = await admin
    .from('notification_preferences')
    .select('type, in_app, push, email')
    .eq('user_id', user.id);
  if (error) {
    console.error('[notifications.prefs.get]', error.message);
    return NextResponse.json({ error: 'Failed to load preferences' }, { status: 500 });
  }
  const prefByType = new Map((prefs || []).map((p) => [p.type, p]));

  return NextResponse.json({
    types: types.map((t) => ({
      id: t.id,
      label: t.label,
      description: t.description,
      category: t.category,
      // Push toggles are shown in the UI but greyed out with "coming soon"
      // until Phase 2 wires Expo push. push_available makes that state
      // explicit for the client.
      push_available: false,
      channels: effectiveChannels(t.id, prefByType.get(t.id) || null),
    })),
  });
}

// PATCH /api/notifications/preferences  { type, push?, email? }
//
// Update one type at a time. Ignored if type is not user-configurable.
export async function PATCH(request) {
  const { user } = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body = {};
  try { body = await request.json(); } catch { /* fall through */ }
  const type = String(body?.type || '');
  const typeDef = NOTIFICATION_TYPES[type];
  if (!typeDef) return NextResponse.json({ error: 'Unknown type' }, { status: 400 });
  if (!typeDef.userConfigurable) {
    return NextResponse.json({ error: 'This notification type cannot be turned off' }, { status: 400 });
  }

  const patch = {
    user_id: user.id,
    type,
    updated_at: new Date().toISOString(),
  };
  if (typeof body.push === 'boolean') patch.push = body.push;
  if (typeof body.email === 'boolean') patch.email = body.email;

  if (!isSupabaseConfigured()) return NextResponse.json({ ok: true });

  const admin = createAdminClient();
  const { error } = await admin
    .from('notification_preferences')
    .upsert(patch, { onConflict: 'user_id,type' });
  if (error) {
    console.error('[notifications.prefs.patch]', error.message);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
