import { NextResponse } from 'next/server';
import { createPersonNote, listPersonNotes } from '@/lib/person-notes';

// Staff notes on a Person Profile. Admin + MFA only; the author comes from
// the session and the person from the server-resolved profile ref.
export async function GET(_request, { params }) {
  const { ref } = await params;
  const result = await listPersonNotes({ ref });
  return NextResponse.json(result.body, { status: result.status });
}

export async function POST(request, { params }) {
  const { ref } = await params;
  const payload = await request.json().catch(() => null);
  const result = await createPersonNote({ ref, rawBody: payload?.body });
  return NextResponse.json(result.body, { status: result.status });
}
