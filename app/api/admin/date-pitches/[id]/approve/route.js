import { NextResponse } from 'next/server';
import { decidePitch } from '@/lib/date-pitches-server';

export const runtime = 'nodejs';

// POST /api/admin/date-pitches/:id/approve
// Creates a Draft event on the pitched date with the Programmer as organizer
// and declines any other pending pitch for that date with "Date filled".
export async function POST(request, { params }) {
  const { id } = await params;
  const result = await decidePitch(request, id, { approve: true });
  return NextResponse.json(result.body, { status: result.status });
}
