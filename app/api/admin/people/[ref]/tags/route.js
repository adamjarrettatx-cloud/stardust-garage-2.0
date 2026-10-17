import { NextResponse } from 'next/server';
import { addPersonTag } from '@/lib/person-notes';

// Staff tags on a Person Profile (e.g. VIP, Regular). Admin + MFA only.
export async function POST(request, { params }) {
  const { ref } = await params;
  const payload = await request.json().catch(() => null);
  const result = await addPersonTag({ ref, rawLabel: payload?.label });
  return NextResponse.json(result.body, { status: result.status });
}
