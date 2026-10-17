import { NextResponse } from 'next/server';
import { deletePersonNote, updatePersonNote } from '@/lib/person-notes';

export async function PATCH(request, { params }) {
  const { ref, noteId } = await params;
  const payload = await request.json().catch(() => null);
  const result = await updatePersonNote({ ref, noteId, rawBody: payload?.body });
  return NextResponse.json(result.body, { status: result.status });
}

export async function DELETE(_request, { params }) {
  const { ref, noteId } = await params;
  const result = await deletePersonNote({ ref, noteId });
  return NextResponse.json(result.body, { status: result.status });
}
