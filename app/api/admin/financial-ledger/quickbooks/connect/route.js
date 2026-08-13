import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth-helpers';
import { resolveSiteUrl } from '@/lib/site-url';
import { buildAuthorizeUrl, createState, isQuickBooksConfigured } from '@/lib/quickbooks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/admin/financial-ledger/quickbooks/connect
//
// The owner clicks "Connect QuickBooks" on Cash Flow, the browser navigates
// HERE (a real top-level navigation — window.location, not fetch — because
// the whole point is to leave the app for Intuit's consent screen), and this
// redirects straight to Intuit's OAuth authorize endpoint.
//
// `state` is a stateless, HMAC-signed, time-boxed token (see
// lib/quickbooks.js createState/verifyState) so the callback can prove the
// code it receives came from a request this app actually issued, without
// needing server-side session storage across the redirect round trip.
export async function GET(request) {
  const { unauthorized } = await requireOwner();
  if (unauthorized) {
    return NextResponse.redirect(new URL('/bananas', resolveSiteUrl(request)));
  }

  if (!isQuickBooksConfigured()) {
    const back = new URL('/bananas/cash-flow', resolveSiteUrl(request));
    back.searchParams.set('qbo_error', 'not_configured');
    return NextResponse.redirect(back);
  }

  try {
    return NextResponse.redirect(buildAuthorizeUrl(createState()));
  } catch (err) {
    console.error('quickbooks connect error:', err);
    const back = new URL('/bananas/cash-flow', resolveSiteUrl(request));
    back.searchParams.set('qbo_error', 'not_configured');
    return NextResponse.redirect(back);
  }
}
