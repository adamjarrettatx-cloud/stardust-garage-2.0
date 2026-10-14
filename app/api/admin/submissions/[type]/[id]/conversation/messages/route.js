import { NextResponse } from 'next/server';
import { postTeamMessage } from '@/lib/submission-conversations';

// Team message or Question. Body: { body, kind?: 'message' | 'question' }
export async function POST(request, { params }) {
  const { type, id } = await params;
  const payload = await request.json().catch(() => null);
  const result = await postTeamMessage({ type, id, rawBody: payload?.body, kind: payload?.kind, request });
  return NextResponse.json(result.body, { status: result.status });
}
