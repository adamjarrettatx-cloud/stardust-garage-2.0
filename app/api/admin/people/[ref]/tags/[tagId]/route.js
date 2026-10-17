import { NextResponse } from 'next/server';
import { removePersonTag } from '@/lib/person-notes';

export async function DELETE(_request, { params }) {
  const { ref, tagId } = await params;
  const result = await removePersonTag({ ref, tagId });
  return NextResponse.json(result.body, { status: result.status });
}
