import { NextResponse } from 'next/server';
import { getRequestUser } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseBearerToken } from '@/lib/request-auth';
import { validateLegalName } from '@/lib/legal-name';

export const runtime = 'nodejs';

export async function PATCH(request) {
  // Browser writes must be same-origin. Bearer callers have no ambient cookies.
  const origin = request.headers.get('origin');
  if (!parseBearerToken(request.headers.get('authorization')) && (!origin || origin !== new URL(request.url).origin)) {
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  }
  try {
    const user = await getRequestUser(request);
    if (!user) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 });
    const body = await request.json().catch(() => null);
    if (!body || Object.keys(body).some((key) => !['fullName', 'phone'].includes(key))) {
      return NextResponse.json({ error: 'Only name and phone can be edited here.' }, { status: 400 });
    }
    const fullName = typeof body.fullName === 'string' ? body.fullName.trim().replace(/\s+/g, ' ') : '';
    const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
    const legalName = validateLegalName(fullName);
    if (!legalName.valid) return NextResponse.json({ error: legalName.error }, { status: 400 });
    if (!fullName || fullName.length > 120 || typeof body.phone !== 'string' || phone.length > 32 || (phone && (!/^[+\d\s().-]+$/.test(phone) || !/^\d{10,15}$/.test(phone.replace(/\D/g, ''))))) {
      return NextResponse.json({ error: 'Enter your name and a valid phone number, or leave phone blank.' }, { status: 400 });
    }
    const admin = createAdminClient();
    const { data: previous, error: readError } = await admin.from('free_accounts').select('phone,phone_verified_at').eq('user_id', user.id).maybeSingle();
    if (readError) throw readError;
    const phoneChanged = (previous?.phone || '').replace(/\D/g, '') !== phone.replace(/\D/g, '');
    const { error } = await admin.from('free_accounts').upsert({
      // The established free_accounts schema stores absent phones as an empty
      // string (phone is NOT NULL); do not require a schema migration for edits.
      user_id: user.id, email: user.email, full_name: fullName, phone,
      // An unchanged number keeps verification; never accept a verification claim from the browser.
      phone_verified_at: phoneChanged ? null : previous?.phone_verified_at || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Could not save your details. Please try again.' }, { status: 500 });
  }
}
