import { NextResponse } from 'next/server';
import { decidePitch } from '@/lib/date-pitches-server';

export const runtime = 'nodejs';

// POST /api/admin/date-pitches/:id/decline  { reason?: string }
export async function POST(request, { params }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const result = await decidePitch(request, id, { approve: false, reason: typeof body?.reason === 'string' ? body.reason : null });
  return NextResponse.json(result.body, { status: result.status });
}
