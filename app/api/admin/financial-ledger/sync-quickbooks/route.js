import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSameOrigin } from '@/lib/manual-income';
import { ACCOUNT_NAMES, yearToDateRange } from '@/lib/financial-ledger';
import { resolveAccountId, auditLedger } from '@/lib/financial-ledger-db';
import { writeLedgerRows } from '@/lib/financial-ledger-write';
import { refreshTokens, listPurchasesSince, listDepositsSince, listJournalEntriesSince } from '@/lib/quickbooks';
import { getConnection, updateTokens, markSynced } from '@/lib/quickbooks-db';
import { buildPurchaseRows, buildDepositRows, buildJournalEntryRows } from '@/lib/quickbooks-ledger';

export const runtime = 'nodejs';

// OWNER-ONLY: pull new/updated Purchase, Deposit, and JournalEntry objects
// from the connected QuickBooks company and mirror them into the unified
// cash-flow ledger, same idempotent writeLedgerRows path TicketTailor and
// SpotOn use (matches on (source, external_ref), so re-running never
// duplicates — see lib/financial-ledger-write.js).
//
// This is additive to the 834 rows already in the ledger from the one-time
// manual backfill done 2026-07-26 — those rows use the same external_ref
// format (qbo:{Type}:{Id}:{LineNum}) so this sync will update rather than
// duplicate any of them if QuickBooks reports a LastUpdatedTime for one that
// falls inside its sync window.
//
// Security posture matches sync-tickettailor: owner gate, same-origin check,
// service-role writes only after the gate.
export async function POST(request) {
  try {
    if (!isSameOrigin(request.headers.get('origin'), request.headers.get('host'))) {
      return NextResponse.json({ error: 'Cross-origin request rejected.' }, { status: 403 });
    }
    const { user, unauthorized } = await requireOwner();
    if (unauthorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createAdminClient();
    const connection = await getConnection(supabase);
    if (!connection) {
      return NextResponse.json({ error: 'QuickBooks is not connected yet.' }, { status: 409 });
    }

    // Refresh proactively if the access token is expired or expiring within
    // the next 2 minutes, rather than waiting for a 401 from QBO. Refresh
    // tokens ROTATE on every use, so the new pair is persisted immediately —
    // if this sync fails after refreshing but before finishing, the next run
    // still has a valid (already-rotated) refresh token to work with.
    let { access_token: accessToken, refresh_token: refreshToken } = connection;
    const expiresInMs = new Date(connection.access_token_expires_at).getTime() - Date.now();
    if (expiresInMs < 2 * 60 * 1000) {
      if (new Date(connection.refresh_token_expires_at).getTime() < Date.now()) {
        return NextResponse.json(
          { error: 'QuickBooks connection expired. Reconnect from Cash Flow.' },
          { status: 409 }
        );
      }
      const refreshed = await refreshTokens(refreshToken);
      const now = Date.now();
      accessToken = refreshed.access_token;
      refreshToken = refreshed.refresh_token;
      await updateTokens(supabase, connection.id, {
        accessToken,
        refreshToken,
        accessTokenExpiresAt: new Date(now + refreshed.expires_in * 1000).toISOString(),
        refreshTokenExpiresAt: new Date(now + refreshed.x_refresh_token_expires_in * 1000).toISOString(),
      });
    }

    const since = connection.last_synced_at || `${yearToDateRange().start}T00:00:00.000Z`;
    const realmId = connection.realm_id;

    const [purchases, deposits, journalEntries] = await Promise.all([
      listPurchasesSince(realmId, accessToken, since),
      listDepositsSince(realmId, accessToken, since),
      listJournalEntriesSince(realmId, accessToken, since),
    ]);

    const accountId = await resolveAccountId(supabase, ACCOUNT_NAMES.quickbooks);
    const purchaseResult = buildPurchaseRows({ purchases, accountId, createdBy: user.id });
    const depositResult = buildDepositRows({ deposits, accountId, createdBy: user.id });
    const journalResult = buildJournalEntryRows({ journalEntries, accountId, createdBy: user.id });

    const rows = [...purchaseResult.rows, ...depositResult.rows, ...journalResult.rows];
    const skipped = {
      purchases: purchaseResult.skipped,
      deposits: depositResult.skipped,
      journalEntries: journalResult.skipped,
    };

    let written = { inserted: 0, updated: 0 };
    if (rows.length) {
      try {
        written = await writeLedgerRows(supabase, rows);
      } catch (writeError) {
        throw new Error(`Could not write the ledger: ${writeError.message}`);
      }
    }

    const syncedAt = new Date().toISOString();
    await markSynced(supabase, connection.id, syncedAt);

    await auditLedger({
      admin: supabase,
      action: 'ledger_quickbooks_sync',
      user,
      request,
      details: {
        synced: rows.length,
        inserted: written.inserted,
        updated: written.updated,
        skipped,
        since,
        purchases_fetched: purchases.length,
        deposits_fetched: deposits.length,
        journal_entries_fetched: journalEntries.length,
      },
    });

    return NextResponse.json({
      success: true,
      synced: rows.length,
      inserted: written.inserted,
      updated: written.updated,
      skipped,
    });
  } catch (err) {
    console.error('financial-ledger sync-quickbooks error:', err);
    return NextResponse.json({ error: 'Server error: ' + (err?.message || 'unknown') }, { status: 500 });
  }
}
