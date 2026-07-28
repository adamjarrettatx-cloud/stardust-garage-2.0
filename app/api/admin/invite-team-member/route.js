import { createClient as createAdminClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { normalizeDepartmentTags } from '@/lib/progress';

export const runtime = 'nodejs';

export async function POST(request) {
  try {
    // Verify caller is an admin via team_members (server-controlled).
    const { user, unauthorized, reason } = await requireAdminMfa();
    if (unauthorized) {
      return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
    }

    const body = await request.json();
    const { email, full_name, role, password } = body;

    if (!email || !role || !password) {
      return NextResponse.json({ error: 'Email, role, and password are required.' }, { status: 400 });
    }
    if (!['admin', 'team'].includes(role)) {
      return NextResponse.json({ error: 'Invalid role.' }, { status: 400 });
    }

    // Optional starting department tags, which scope what tasks they will see.
    const { departments, invalid } = normalizeDepartmentTags(body.departments || []);
    if (invalid.length > 0) {
      return NextResponse.json({ error: `Invalid department: ${invalid.join(', ')}` }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ error: 'Missing environment variables: SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 });
    }

    // Admin client using service role
    const admin = createAdminClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Check if already a team member
    const { data: existing } = await admin
      .from('team_members')
      .select('id')
      .eq('email', email.trim().toLowerCase())
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: 'This email is already a team member.' }, { status: 400 });
    }

    // Try to create the auth user
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password: password.trim(),
      email_confirm: true,
      user_metadata: {
        full_name: full_name?.trim() || '',
        is_admin: role === 'admin',
      },
    });

    let authUserId;

    if (createErr) {
      // User might already exist in auth — look them up by email
      const { data: listData, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
      if (listErr) {
        return NextResponse.json({ error: 'Failed to create user: ' + createErr.message }, { status: 400 });
      }
      const found = listData.users.find(u => u.email?.toLowerCase() === email.trim().toLowerCase());
      if (!found) {
        return NextResponse.json({ error: createErr.message }, { status: 400 });
      }
      authUserId = found.id;
      // Update password and metadata for existing user
      await admin.auth.admin.updateUserById(authUserId, {
        password: password.trim(),
        user_metadata: {
          full_name: full_name?.trim() || '',
          is_admin: role === 'admin',
        },
      });
    } else {
      authUserId = created.user.id;
    }

    // Insert into team_members
    const { data: member, error: insertErr } = await admin
      .from('team_members')
      .insert({
        user_id: authUserId,
        email: email.trim().toLowerCase(),
        full_name: full_name?.trim() || null,
        role,
        departments,
        invited_by: user.id,
      })
      .select()
      .single();

    if (insertErr) {
      return NextResponse.json({ error: 'DB insert failed: ' + insertErr.message }, { status: 400 });
    }

    return NextResponse.json({ member });

  } catch (err) {
    console.error('invite-team-member error:', err);
    return NextResponse.json({ error: 'Unexpected error: ' + (err?.message || String(err)) }, { status: 500 });
  }
}
