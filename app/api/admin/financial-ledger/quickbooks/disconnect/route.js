import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSameOrigin } from '@/lib/manual-income';
import { getConnection, deleteConnection } from '@/lib/quickbooks-db';
import { auditLedger } from '@/lib/financial-ledger-db';

export const runtime = 'nodejs';

// POST /api/admin/financial-ledger/quickbooks/disconnect
//
// Deletes the stored token pair. Does NOT touch any financial_transactions
// rows already synced — this only stops future syncing until reconnected.
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
      return NextResponse.json({ success: true, alreadyDisconnected: true });
    }

    await deleteConnection(supabase, connection.id);
    await auditLedger({
      admin: supabase,
      action: 'ledger_quickbooks_disconnect',
      user,
      request,
      details: { realm_id: connection.realm_id },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('financial-ledger quickbooks disconnect error:', err);
    return NextResponse.json({ error: 'Server error: ' + (err?.message || 'unknown') }, { status: 500 });
  }
}
