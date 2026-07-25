import { NextResponse } from 'next/server';
import { updateSubmissionStatusRecord } from '@/lib/submission-status';

export async function POST(request, { params }) {
  const { type, id } = await params;
  const body = await request.json().catch(() => null);

  if (!body?.status) {
    return NextResponse.json({ error: 'status is required.' }, { status: 400 });
  }

  const result = await updateSubmissionStatusRecord({
    type,
    id,
    nextStatus: body.status,
  });

  return NextResponse.json(result.body, { status: result.status });
}
