// Server-side glue for the QuickBooks connection + sync. Anything pure lives
// in lib/quickbooks.js (API I/O) and lib/quickbooks-ledger.js (row mapping);
// this file only touches Supabase. Never import from a client component.

// This app connects to exactly one QuickBooks company at a time, so "the"
// connection is just the most recently updated row — a future reconnect (or
// connecting a different company) supersedes the old one instead of
// requiring an explicit delete first.
export async function getConnection(admin) {
  const { data, error } = await admin
    .from('qbo_connections')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not read qbo_connections: ${error.message}`);
  return data || null;
}

// Upserts on realm_id (the unique key) — a reconnect of the same company
// replaces its tokens in place; connecting a different company inserts a new
// row, and getConnection() above will then prefer whichever was touched last.
export async function upsertConnection(admin, {
  realmId, accessToken, refreshToken, accessTokenExpiresAt, refreshTokenExpiresAt, environment, connectedBy,
}) {
  const row = {
    realm_id: realmId,
    access_token: accessToken,
    refresh_token: refreshToken,
    access_token_expires_at: accessTokenExpiresAt,
    refresh_token_expires_at: refreshTokenExpiresAt,
    environment,
    connected_by: connectedBy,
  };

  const { data: existing, error: findError } = await admin
    .from('qbo_connections')
    .select('id')
    .eq('realm_id', realmId)
    .maybeSingle();
  if (findError) throw new Error(`Could not read qbo_connections: ${findError.message}`);

  if (existing) {
    const { error } = await admin.from('qbo_connections').update(row).eq('id', existing.id);
    if (error) throw new Error(`Could not update qbo_connections: ${error.message}`);
    return existing.id;
  }

  const { data, error } = await admin.from('qbo_connections').insert(row).select('id').single();
  if (error) throw new Error(`Could not insert qbo_connections: ${error.message}`);
  return data.id;
}

export async function updateTokens(admin, id, { accessToken, refreshToken, accessTokenExpiresAt, refreshTokenExpiresAt }) {
  const { error } = await admin
    .from('qbo_connections')
    .update({
      access_token: accessToken,
      refresh_token: refreshToken,
      access_token_expires_at: accessTokenExpiresAt,
      refresh_token_expires_at: refreshTokenExpiresAt,
    })
    .eq('id', id);
  if (error) throw new Error(`Could not refresh qbo_connections tokens: ${error.message}`);
}

export async function markSynced(admin, id, syncedAtIso) {
  const { error } = await admin.from('qbo_connections').update({ last_synced_at: syncedAtIso }).eq('id', id);
  if (error) throw new Error(`Could not update qbo_connections.last_synced_at: ${error.message}`);
}

export async function deleteConnection(admin, id) {
  const { error } = await admin.from('qbo_connections').delete().eq('id', id);
  if (error) throw new Error(`Could not delete qbo_connections: ${error.message}`);
}
