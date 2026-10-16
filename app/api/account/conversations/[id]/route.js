import { NextResponse } from 'next/server';
import { getMyConversation } from '@/lib/submission-conversations';

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const { id } = await params;
  const result = await getMyConversation({ threadId: id, request });
  return NextResponse.json(result.body, { status: result.status });
}
