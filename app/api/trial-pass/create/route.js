import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/trial-pass/create — DEPRECATED
//
// The public "no-verification" path is gone. The intake flow is now:
//
//   1. POST /api/trial-pass/verify/start   (public, sends the code)
//   2. POST /api/trial-pass/verify/check   (public, issues on approved code)
//
// Staff who need the dead-phone / foreign-number escape hatch use:
//
//     POST /api/team/trial-pass/manual     (team session required)
//
// This endpoint is left in place so a bookmarked or in-flight request from
// the old form gets a clear, non-500 answer explaining what to do — and so
// nothing scripted against the old shape silently keeps minting unverified
// passes.
//
// The gate matters. If we let unverified callers through here, the whole
// point of Twilio Verify is defeated: someone can still POST the three
// fields directly and hold a pass without ever proving control of the phone.
export async function POST() {
  return NextResponse.json(
    {
      error:
        'Trial pass creation now requires phone verification. Refresh /pass and try again.',
      code: 'verification_required',
      endpoint: '/api/trial-pass/verify/start',
    },
    { status: 410 },
  );
}
