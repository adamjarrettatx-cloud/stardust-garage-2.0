import { NextResponse } from 'next/server';
import { requireTeam } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { auditContact, CONTACT_AUDIT_ACTIONS } from '@/lib/contact-helpers';

export const runtime = 'nodejs';

// POST /api/admin/contacts/:id/audit
// Body: { action, details? }
//
// Contact CRUD itself runs through the browser client against RLS (see
// ContactForm.js), but the audit trail is written here so ip_address and
// user_agent come from the real request headers and the actor is the
// server-verified session user — a client can't spoof or skip either.
// Team-gated: admins and team members both maintain contacts.
export async function POST(request, { params }) {
  const { user, unauthorized } = await requireTeam();
  if (unauthorized) {
    return NextResponse.json({ error: 'Team access required.' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  if (!CONTACT_AUDIT_ACTIONS.includes(body.action)) {
    return NextResponse.json({ error: 'Invalid action.' }, { status: 400 });
  }

  const admin = createAdminClient();

  // The audit row FKs to contacts(id); reject an unknown id with a clear 404
  // rather than letting the insert fail silently inside auditContact().
  const { data: contact } = await admin
    .from('contacts')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (!contact) return NextResponse.json({ error: 'Contact not found.' }, { status: 404 });

  await auditContact({
    admin,
    action: body.action,
    contactId: id,
    actorId: user.id,
    actorEmail: user.email,
    request,
    details: body.details ?? null,
  });

  return NextResponse.json({ success: true });
}
