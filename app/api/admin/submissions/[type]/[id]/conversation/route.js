import { NextResponse } from 'next/server';
import { getTeamConversation, inviteToConversation, setConversationStatus } from '@/lib/submission-conversations';

// Submission conversation (team side). Admin + MFA only; see
// lib/submission-conversations.js for every rule.
export async function GET(_request, { params }) {
  const { type, id } = await params;
  const result = await getTeamConversation({ type, id });
  return NextResponse.json(result.body, { status: result.status });
}

// Invite (or resend the invite, or re-target it to a corrected email).
// Body: { email?, body?, kind?: 'message' | 'question' }
export async function POST(request, { params }) {
  const { type, id } = await params;
  const payload = await request.json().catch(() => null);
  const result = await inviteToConversation({
    type,
    id,
    rawEmail: payload?.email,
    rawBody: payload?.body,
    kind: payload?.kind,
    request,
  });
  return NextResponse.json(result.body, { status: result.status });
}

// Close or reopen. Body: { status: 'open' | 'closed' }
export async function PATCH(request, { params }) {
  const { type, id } = await params;
  const payload = await request.json().catch(() => null);
  const result = await setConversationStatus({ type, id, status: payload?.status });
  return NextResponse.json(result.body, { status: result.status });
}
