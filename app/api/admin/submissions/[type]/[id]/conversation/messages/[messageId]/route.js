import { NextResponse } from 'next/server';
import { deleteTeamMessage } from '@/lib/submission-conversations';

// Soft-deletes a team message (author or owner). The row stays for audit.
export async function DELETE(_request, { params }) {
  const { type, id, messageId } = await params;
  const result = await deleteTeamMessage({ type, id, messageId });
  return NextResponse.json(result.body, { status: result.status });
}
