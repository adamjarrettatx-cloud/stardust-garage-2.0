import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export async function POST(request) {
  // Verify caller is an admin
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !user.user_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { email, full_name, role, password } = await request.json();
  if (!email || !role || !password) {
    return NextResponse.json({ error: 'Email, role, and password are required.' }, { status: 400 });
  }
  if (!['admin', 'team'].includes(role)) {
    return NextResponse.json({ error: 'Invalid role.' }, { status: 400 });
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return NextResponse.json({ error: 'Server misconfiguration: SUPABASE_SERVICE_ROLE_KEY is not set. Add it to your Vercel environment variables.' }, { status: 500 });
  }

  // Use service role client to create the auth user
  const adminSupabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    serviceRoleKey
  );

  // Check if user already exists in team_members
  const { data: existing } = await adminSupabase
    .from('team_members')
    .select('id')
    .eq('email', email.toLowerCase())
    .single();

  if (existing) {
    return NextResponse.json({ error: 'This email is already a team member.' }, { status: 400 });
  }

  // Create auth user (or get existing)
  let authUserId;
  const { data: newUser, error: createErr } = await adminSupabase.auth.admin.createUser({
    email: email.toLowerCase(),
    password,
    email_confirm: true,
    user_metadata: {
      full_name: full_name || '',
      is_admin: role === 'admin',
    },
  });

  if (createErr) {
    // If user already exists in auth, look them up
    if (createErr.message?.includes('already been registered') || createErr.code === 'email_exists') {
      const { data: { users } } = await adminSupabase.auth.admin.listUsers();
      const found = users.find(u => u.email?.toLowerCase() === email.toLowerCase());
      if (!found) {
        return NextResponse.json({ error: createErr.message }, { status: 400 });
      }
      authUserId = found.id;
      // Update their metadata
      await adminSupabase.auth.admin.updateUserById(authUserId, {
        user_metadata: { full_name: full_name || '', is_admin: role === 'admin' },
      });
    } else {
      return NextResponse.json({ error: createErr.message }, { status: 400 });
    }
  } else {
    authUserId = newUser.user.id;
  }

  // Insert into team_members
  const { data: member, error: insertErr } = await adminSupabase
    .from('team_members')
    .insert({
      user_id: authUserId,
      email: email.toLowerCase(),
      full_name: full_name || null,
      role,
      invited_by: user.id,
    })
    .select()
    .single();

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 400 });
  }

  return NextResponse.json({ member });
}
