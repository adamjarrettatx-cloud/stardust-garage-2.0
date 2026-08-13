import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { getConnection } from '@/lib/quickbooks-db';
import { isQuickBooksConfigured } from '@/lib/quickbooks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/admin/financial-ledger/quickbooks/status
//
// Lets SyncQuickBooksButton decide on mount whether to show "Connect
// QuickBooks" or "Sync QuickBooks" — no tokens are ever returned to the
// client, only the fields the UI needs.
export async function GET(request) {
  const { unauthorized } = await requireOwner();
  if (unauthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const configured = isQuickBooksConfigured();
  const connection = configured ? await getConnection(createAdminClient()) : null;

  return NextResponse.json({
    configured,
    connected: Boolean(connection),
    realmId: connection?.realm_id || null,
    lastSyncedAt: connection?.last_synced_at || null,
    environment: connection?.environment || null,
  });
}
