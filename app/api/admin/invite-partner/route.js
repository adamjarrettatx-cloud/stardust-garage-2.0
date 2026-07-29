import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { auditContact, contactTypeLabel } from '@/lib/contact-helpers';
import { sendPartnerInvite } from '@/lib/email';

export const runtime = 'nodejs';

// POST /api/admin/invite-partner
// Body: { contactId: string }
//
// Turns a Contact into a Partner: creates (or reuses) a Supabase auth user for
// the email on file, opens a pending partner_profiles row, and emails them a
// one-time magic link that lands on /partner/activate where they confirm their
// name and upload the photo door staff will see.
//
// Provisioning mirrors /api/admin/approve-member: service-role client, dedupe
// against an existing auth user rather than failing on a second invite. Two
// deliberate differences:
//   * no password is generated — the magic link IS the credential, so nothing
//     sensitive travels in the email;
//   * user_metadata gets is_partner: true and never is_admin. Nothing reads that
//     flag for authorization (partner_profiles.is_active is the source of
//     truth); it is there so a human looking at the Supabase auth dashboard can
//     tell what an account is for.
export async function POST(request) {
  try {
    const { user, unauthorized, reason } = await requireAdminMfa();
    if (unauthorized) {
      return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const contactId = body?.contactId;
    if (!contactId) {
      return NextResponse.json({ error: 'Missing contactId' }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data: contact } = await admin
      .from('contacts')
      .select('id, display_name, primary_contact_name, contact_type, email')
      .eq('id', contactId)
      .maybeSingle();

    if (!contact) {
      return NextResponse.json({ error: 'Contact not found.' }, { status: 404 });
    }
    if (!contact.email) {
      return NextResponse.json(
        { error: 'Add an email address to this contact before inviting them.' },
        { status: 400 }
      );
    }

    const email = contact.email.trim().toLowerCase();
    const fullName = contact.primary_contact_name?.trim() || contact.display_name;

    // Find-or-create the auth user. createUser fails when the email is already
    // registered (they might be a past applicant or another contact's partner),
    // in which case we link to the account that already exists instead.
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: fullName, is_partner: true },
    });

    let userId;
    if (createErr) {
      const { data: listData, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
      if (listErr) {
        return NextResponse.json(
          { error: 'Failed to create user: ' + createErr.message },
          { status: 400 }
        );
      }
      const found = listData.users.find((u) => u.email?.toLowerCase() === email);
      if (!found) {
        return NextResponse.json({ error: createErr.message }, { status: 400 });
      }
      userId = found.id;
    } else {
      userId = created.user.id;
    }

    // One partner login per contact — a re-invite refreshes invited_at and the
    // link rather than opening a second profile.
    const { error: profileErr } = await admin
      .from('partner_profiles')
      .upsert(
        {
          user_id: userId,
          contact_id: contact.id,
          full_name: fullName,
          is_active: false,
          invited_by: user.id,
          invited_at: new Date().toISOString(),
        },
        { onConflict: 'contact_id' }
      );

    if (profileErr) {
      // user_id is unique too: this fires when the same email is already the
      // partner login for a different contact.
      console.error('partner_profiles upsert failed:', profileErr);
      return NextResponse.json(
        {
          error:
            'Could not create the partner profile. This email may already be the partner login for another contact.',
        },
        { status: 400 }
      );
    }

    // Absolute URL convention used by /api/stripe/checkout and
    // /api/membership/billing-portal: trust the request Origin, fall back to
    // production. There is no NEXT_PUBLIC_SITE_URL in this project.
    const origin = request.headers.get('origin') || 'https://sdgatx.com';

    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo: `${origin}/partner/activate` },
    });

    if (linkErr || !link?.properties?.action_link) {
      return NextResponse.json(
        { error: 'Could not generate an activation link: ' + (linkErr?.message || 'unknown') },
        { status: 500 }
      );
    }

    const activationUrl = link.properties.action_link;
    const contactType = (contact.contact_type || []).map(contactTypeLabel).join(', ');

    // A failed send must not lose the invite: the profile row already exists, so
    // hand the link back to the admin to pass along instead of rolling back.
    let emailSent = true;
    let emailError = null;
    try {
      await sendPartnerInvite({ email, fullName, contactType, activationUrl });
    } catch (err) {
      emailSent = false;
      emailError = err?.message || String(err);
      console.error('Partner invite email failed:', emailError);
      console.log('[invite-partner] activation link for', email, activationUrl);
    }

    await auditContact({
      admin,
      action: 'update',
      contactId: contact.id,
      actorId: user.id,
      actorEmail: user.email,
      request,
      details: {
        note: emailSent
          ? `Partner invite sent to ${email}`
          : `Partner invite created for ${email} (email delivery failed)`,
      },
    });

    return NextResponse.json({
      ok: true,
      userId,
      emailSent,
      emailError,
      // Only returned when the email didn't go out — this route is admin-gated,
      // and without it a Resend outage would strand the invitee.
      activationUrl: emailSent ? null : activationUrl,
    });
  } catch (err) {
    console.error('invite-partner route error:', err);
    return NextResponse.json(
      { error: 'Server error: ' + (err?.message || 'unknown') },
      { status: 500 }
    );
  }
}
