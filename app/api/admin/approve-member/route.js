import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { sendMemberWelcome } from '@/lib/email';

// POST /api/admin/approve-member
// Body: { applicationId: string }
//
// Approves a membership application AND auto-provisions:
//   1. Supabase auth user (with generated temp password)
//   2. member_profiles row linking user to application
//   3. application.account_created = true
//   4. Email to the new member with their login credentials
//
// Requires admin auth. Uses service-role key for user creation since
// that's the only key allowed to create auth users from server code.

function generateTempPassword() {
  // 14-character alphanumeric password. Mixed case, includes a digit
  // and a symbol so it passes any password strength requirements.
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let pw = '';
  for (let i = 0; i < 12; i++) {
    pw += chars[Math.floor(Math.random() * chars.length)];
  }
  // Add a digit + a punctuation char to broaden the character set
  pw += Math.floor(Math.random() * 10);
  pw += '!@#$%&*'[Math.floor(Math.random() * 7)];
  return pw;
}

export async function POST(request) {
  try {
    // Verify the caller is an admin (via the normal server-side client
    // that reads cookies).
    const serverClient = await createServerClient();
    const { data: { user: adminUser } } = await serverClient.auth.getUser();
    if (!adminUser || !adminUser.user_metadata?.is_admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { applicationId } = await request.json();
    if (!applicationId) {
      return NextResponse.json({ error: 'Missing applicationId' }, { status: 400 });
    }

    // Use service role for everything that follows so we can create users
    // and bypass RLS for the admin-only writes.
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Fetch the application
    const { data: application, error: fetchError } = await supabaseAdmin
      .from('membership_applications')
      .select('*')
      .eq('id', applicationId)
      .single();

    if (fetchError || !application) {
      return NextResponse.json({ error: 'Application not found' }, { status: 404 });
    }

    // If account already created, refuse to create a duplicate
    if (application.account_created) {
      // Still mark the application approved if it isn't (idempotent)
      if (application.status !== 'approved') {
        await supabaseAdmin
          .from('membership_applications')
          .update({ status: 'approved' })
          .eq('id', applicationId);
      }
      return NextResponse.json({
        ok: true,
        alreadyHadAccount: true,
        message: 'Application is already approved with an active account',
      });
    }

    // Check if a Supabase auth user already exists with this email
    // (e.g. someone applied twice). If so, link to the existing user
    // rather than failing.
    const email = application.email.trim().toLowerCase();
    const { data: existing } = await supabaseAdmin.auth.admin.listUsers();
    const existingUser = existing?.users?.find(
      (u) => u.email?.toLowerCase() === email
    );

    let userId;
    let tempPassword = null;

    if (existingUser) {
      userId = existingUser.id;
      // Don't reset their password — they already have one
    } else {
      // Create a new auth user
      tempPassword = generateTempPassword();
      const { data: created, error: createError } =
        await supabaseAdmin.auth.admin.createUser({
          email,
          password: tempPassword,
          email_confirm: true, // skip verification email; we send our own
          user_metadata: {
            full_name: application.full_name,
            is_admin: false,
          },
        });

      if (createError || !created?.user) {
        return NextResponse.json(
          { error: 'Failed to create user: ' + (createError?.message || 'unknown') },
          { status: 500 }
        );
      }
      userId = created.user.id;
    }

    // Create/update member_profiles row
    const { error: profileError } = await supabaseAdmin
      .from('member_profiles')
      .upsert(
        {
          user_id: userId,
          application_id: applicationId,
          full_name: application.full_name,
          email,
          is_active: false,
        },
        { onConflict: 'user_id' }
      );

    if (profileError) {
      console.error('Profile upsert failed:', profileError);
      return NextResponse.json(
        { error: 'Failed to create member profile: ' + profileError.message },
        { status: 500 }
      );
    }

    // Mark application approved + account_created
    await supabaseAdmin
      .from('membership_applications')
      .update({
        status: 'approved',
        account_created: true,
      })
      .eq('id', applicationId);

    // Send welcome email (only if we generated a new password — if user
    // already existed, they keep their existing credentials, no need to
    // surprise them with a "your password is" email).
    if (tempPassword) {
      try {
        await sendMemberWelcome({
          email,
          fullName: application.full_name,
          tempPassword,
        });
      } catch (emailErr) {
        console.error('Welcome email failed:', emailErr?.message || emailErr);
        // Don't fail the approval — admin can manually share the password
      }
    }

    return NextResponse.json({
      ok: true,
      userId,
      passwordEmailed: Boolean(tempPassword),
    });
  } catch (err) {
    console.error('approve-member route error:', err);
    return NextResponse.json(
      { error: 'Server error: ' + (err?.message || 'unknown') },
      { status: 500 }
    );
  }
}
