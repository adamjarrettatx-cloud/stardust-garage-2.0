import { NextResponse } from 'next/server';
import { listMyConversations } from '@/lib/submission-conversations';

export const dynamic = 'force-dynamic';

// The signed-in account's conversations with the SDG team. Accepts a session
// cookie (web) or a bearer token (mobile).
export async function GET(request) {
  const result = await listMyConversations({ request });
  return NextResponse.json(result.body, { status: result.status });
}
