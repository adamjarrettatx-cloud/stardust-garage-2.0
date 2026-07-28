import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveSubmissionTypeConfig } from '@/lib/submission-workflow';
import { sendTeamReply } from '@/lib/email';

// Sends a reply email from a submission detail page (venue inquiry,
// micro-party, collaboration, application). The email sends from the shared
// hello@sdgatx.com address but with Reply-To set to the signed-in admin's own
// work email, so the recipient's reply lands in that admin's real Gmail
// inbox. Every send is logged to submission_email_replies for accountability.
export async function POST(request, { params }) {
  const { type, id } = await params;
  const { user, unauthorized } = await requireAdminMfa();
  if (unauthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const config = resolveSubmissionTypeConfig(type);
  if (!config) {
    return NextResponse.json({ error: 'Unknown submission type.' }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const subject = (body?.subject || '').trim();
  const bodyText = (body?.body || '').trim();
  const to = (body?.to || '').trim();

  if (!subject || !bodyText || !to) {
    return NextResponse.json({ error: 'subject, body, and to are required.' }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Confirm the submission exists and belongs to this type before sending,
  // and pull the sender's own team profile (name + real work email) so the
  // email looks and replies like it's genuinely from them.
  const { data: submission, error: fetchError } = await supabase
    .from(config.table)
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 400 });
  }
  if (!submission) {
    return NextResponse.json({ error: 'Submission not found.' }, { status: 404 });
  }

  const { data: teamMember } = await supabase
    .from('team_members')
    .select('email, full_name')
    .eq('user_id', user.id)
    .maybeSingle();

  const senderEmail = teamMember?.email || user.email;
  const senderName = teamMember?.full_name || null;

  try {
    await sendTeamReply({ to, subject, bodyText, senderEmail, senderName });
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Failed to send email.' }, { status: 502 });
  }

  const { error: logError } = await supabase.from('submission_email_replies').insert({
    submission_type: type,
    submission_id: id,
    sent_by: user.id,
    sent_by_email: senderEmail,
    sent_by_name: senderName,
    to_email: to,
    subject,
    body: bodyText,
  });
  // Logging failure shouldn't fail the request — the email already sent.
  if (logError) {
    console.error('Failed to log submission_email_replies:', logError.message);
  }

  return NextResponse.json({ ok: true });
}

// Returns the send history for this submission (most recent first) so the
// admin dashboard can show a small "sent" trail under the compose panel.
export async function GET(request, { params }) {
  const { type, id } = await params;
  const { unauthorized } = await requireAdminMfa();
  if (unauthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const config = resolveSubmissionTypeConfig(type);
  if (!config) {
    return NextResponse.json({ error: 'Unknown submission type.' }, { status: 404 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('submission_email_replies')
    .select('id, sent_by_name, sent_by_email, to_email, subject, body, created_at')
    .eq('submission_type', type)
    .eq('submission_id', id)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ replies: data || [] });
}
