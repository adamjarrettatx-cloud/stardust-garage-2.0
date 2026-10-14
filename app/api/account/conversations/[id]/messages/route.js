import { NextResponse } from 'next/server';
import { postGuestMessage } from '@/lib/submission-conversations';
import { keyFromRequest, rateLimit } from '@/lib/rate-limit';

// Body: { body, replyToId? } — replyToId answers a team Question.
export async function POST(request, { params }) {
  const { id } = await params;
  if (!rateLimit({ key: keyFromRequest(request, `conversation_post:${id}`), limit: 30, windowMs: 10 * 60_000 }).ok) {
    return NextResponse.json({ error: 'Too many messages. Please wait a few minutes.' }, { status: 429 });
  }
  const payload = await request.json().catch(() => null);
  const result = await postGuestMessage({ threadId: id, rawBody: payload?.body, replyToId: payload?.replyToId || null, request });
  return NextResponse.json(result.body, { status: result.status });
}
