// Server-side glue shared by the two ledger admin routes. Anything pure lives
// in lib/financial-ledger.js / lib/spoton-import.js; this file only holds the
// bits that touch Supabase. Never import it from a client component.

import { audit } from './document-helpers.js';

// Resolve a seeded account name (see ACCOUNT_NAMES) to its uuid. The account
// rows are created by the migration, so a miss means the migration has not been
// applied in this environment — surface that clearly instead of inserting
// transactions with a null account.
export async function resolveAccountId(admin, name) {
  const { data, error } = await admin
    .from('financial_accounts')
    .select('id, is_active')
    .eq('name', name)
    .maybeSingle();
  if (error) throw new Error(`Could not read financial_accounts: ${error.message}`);
  if (!data) {
    throw new Error(`No "${name}" account exists. Apply the financial ledger migration first.`);
  }
  return data.id;
}

// Audit-log a ledger action into the existing public.document_audit_log, the
// same table the document/contract hub writes to. document_id/version_id stay
// null; the ledger context goes in `details`. The action strings are whitelisted
// by the check constraint widened in 20260726_financial_ledger.sql.
export async function auditLedger({ admin, action, user, request, details }) {
  await audit({
    admin,
    action,
    actorId: user?.id || null,
    actorEmail: user?.email || null,
    request,
    details,
  });
}
