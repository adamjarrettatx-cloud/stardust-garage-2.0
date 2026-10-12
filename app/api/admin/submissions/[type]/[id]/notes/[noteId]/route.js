import { NextResponse } from 'next/server';
import { deleteSubmissionNote, updateSubmissionNote } from '@/lib/submission-notes';

// Edit (author only) or soft-delete (author or owner) one team note.
export async function PATCH(request, { params }) {
  const { type, id, noteId } = await params;
  const payload = await request.json().catch(() => null);
  const result = await updateSubmissionNote({ type, id, noteId, rawBody: payload?.body });
  return NextResponse.json(result.body, { status: result.status });
}

export async function DELETE(_request, { params }) {
  const { type, id, noteId } = await params;
  const result = await deleteSubmissionNote({ type, id, noteId });
  return NextResponse.json(result.body, { status: result.status });
}
