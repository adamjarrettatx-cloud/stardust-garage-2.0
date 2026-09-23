import { NextResponse } from 'next/server';
import { getRequestUser } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { accountLegalName } from '@/lib/account-legal-name';

export const dynamic = 'force-dynamic';
export async function GET(request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  try {
    const profile = await accountLegalName(createAdminClient(), user.id);
    return NextResponse.json(profile, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Could not check your profile. Please retry.' }, { status: 503 });
  }
}
