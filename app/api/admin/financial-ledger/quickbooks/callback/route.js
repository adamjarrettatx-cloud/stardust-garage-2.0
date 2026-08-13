import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveSiteUrl } from '@/lib/site-url';
import { verifyState, exchangeCodeForTokens } from '@/lib/quickbooks';
import { upsertConnection } from '@/lib/quickbooks-db';
import { auditLedger } from '@/lib/financial-ledger-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function cashFlowRedirect(request, params) {
  const url = new URL('/bananas/cash-flow', resolveSiteUrl(request));
  Object.entries(params).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });
  return NextResponse.redirect(url);
}

// GET /api/admin/financial-ledger/quickbooks/callback?code=...&realmId=...&state=...
//
// Where Intuit drops the owner after they approve (or refuse) access.
// Exchanges the code for the first access/refresh token pair and stores it —
// everything after this is the "Sync QuickBooks" button calling
// /sync-quickbooks; there is no other OAuth round trip until the refresh
// token itself expires from ~100 days of inactivity.
export async function GET(request) {
  const { user, unauthorized } = await requireOwner();
  if (unauthorized) return cashFlowRedirect(request, { qbo_error: 'unauthorized' });

  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const realmId = requestUrl.searchParams.get('realmId');
  const state = requestUrl.searchParams.get('state');
  const intuitError = requestUrl.searchParams.get('error');

  if (intuitError) {
    console.error('[quickbooks/callback] Intuit returned an error:', intuitError);
    return cashFlowRedirect(request, { qbo_error: 'declined' });
  }
  if (!code || !realmId) {
    return cashFlowRedirect(request, { qbo_error: 'missing_code' });
  }
  if (!verifyState(state)) {
    console.error('[quickbooks/callback] state mismatch or expired');
    return cashFlowRedirect(request, { qbo_error: 'bad_state' });
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const now = Date.now();
    const admin = createAdminClient();

    await upsertConnection(admin, {
      realmId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      accessTokenExpiresAt: new Date(now + tokens.expires_in * 1000).toISOString(),
      refreshTokenExpiresAt: new Date(now + tokens.x_refresh_token_expires_in * 1000).toISOString(),
      environment: process.env.QUICKBOOKS_ENVIRONMENT === 'sandbox' ? 'sandbox' : 'production',
      connectedBy: user.id,
    });

    await auditLedger({
      admin,
      action: 'ledger_quickbooks_connect',
      user,
      request,
      details: { realm_id: realmId },
    });

    return cashFlowRedirect(request, { qbo_connected: '1' });
  } catch (err) {
    console.error('quickbooks callback error:', err);
    return cashFlowRedirect(request, { qbo_error: 'token_exchange_failed' });
  }
}
