import { NextResponse } from 'next/server';
import { createSubmissionNote, listSubmissionNotes } from '@/lib/submission-notes';

// Internal team notes on a submission. Admin + MFA only; author is derived
// server-side from the session. See lib/submission-notes.js.
export async function GET(_request, { params }) {
  const { type, id } = await params;
  const result = await listSubmissionNotes({ type, id });
  return NextResponse.json(result.body, { status: result.status });
}

export async function POST(request, { params }) {
  const { type, id } = await params;
  const payload = await request.json().catch(() => null);
  const result = await createSubmissionNote({ type, id, rawBody: payload?.body });
  return NextResponse.json(result.body, { status: result.status });
}
