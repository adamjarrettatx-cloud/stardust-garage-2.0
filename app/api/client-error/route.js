import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/client-error
// Body: { message, stack?, digest?, path?, ua? }
//
// Fire-and-forget endpoint the client-side error boundaries hit when they
// catch a render exception. We don't have Sentry wired up (yet), so the
// simplest way to actually see what's breaking in the field is to log it
// server-side where Vercel's log stream picks it up.
//
// Deliberately unauthenticated — an error can happen before or during
// auth, and we care more about seeing the crash than about who threw it.
// Body is capped at 8 KB so a chatty stack can't spam the log stream.

export async function POST(request) {
  try {
    const raw = await request.text();
    const capped = raw.length > 8192 ? raw.slice(0, 8192) + '\u2026' : raw;
    let payload;
    try { payload = JSON.parse(capped); } catch { payload = { raw: capped }; }

    const ua = request.headers.get('user-agent') || '';
    const referer = request.headers.get('referer') || '';

    console.error('[client-error]', JSON.stringify({
      ...payload,
      ua,
      referer,
      at: new Date().toISOString(),
    }));
  } catch {
    // Never let error-reporting error out.
  }
  return NextResponse.json({ ok: true });
}
