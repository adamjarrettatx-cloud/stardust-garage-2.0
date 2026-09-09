// Server-side issuance policy for mobile Member ID tokens.
//
// Kept independent from Next.js so the important rotation behavior can be
// tested with a small fake Supabase client. The caller supplies mintToken(),
// which keeps the established token generator and SHA-256 hashing logic in
// lib/member-identity.js as the single source of the token format.

const REFRESH_WINDOW_MS = 60 * 60 * 1000;
const TOKEN_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;

function asValidDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function responseFor(row) {
  const expiresAt = asValidDate(row?.expires_at);
  const issuedAt = asValidDate(row?.issued_at);
  if (!row?.token_raw || !expiresAt || !issuedAt) return null;

  return {
    token: row.token_raw,
    expiresAt: expiresAt.toISOString(),
    issuedAt: issuedAt.toISOString(),
  };
}

// Resolves an active member's current Member ID token, rotating it only when
// it is absent or inside the one-hour refresh window.
//
// Returns one of:
//   { kind: 'ok', token, expiresAt, issuedAt }
//   { kind: 'not_a_member' }
//   { kind: 'error', error }
export async function getOrIssueMemberIdentityToken({
  admin,
  userId,
  now = new Date(),
  mintToken,
}) {
  const nowDate = asValidDate(now);
  if (!nowDate) throw new TypeError('now must be a valid date');
  if (typeof mintToken !== 'function') throw new TypeError('mintToken must be a function');

  const nowIso = nowDate.toISOString();
  const refreshCutoffIso = new Date(nowDate.getTime() + REFRESH_WINDOW_MS).toISOString();
  const expiresAtIso = new Date(nowDate.getTime() + TOKEN_LIFETIME_MS).toISOString();

  const { data: member, error: memberError } = await admin
    .from('member_profiles')
    .select('id, is_active')
    .eq('user_id', userId)
    .maybeSingle();

  if (memberError) return { kind: 'error', error: memberError };
  if (!member?.id || member.is_active !== true) return { kind: 'not_a_member' };

  const { data: existing, error: existingError } = await admin
    .from('member_identity_tokens')
    .select('token_raw, expires_at, issued_at')
    .eq('member_profile_id', member.id)
    .is('revoked_at', null)
    .gt('expires_at', nowIso)
    .order('expires_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) return { kind: 'error', error: existingError };

  const existingResponse = responseFor(existing);
  if (existingResponse && new Date(existingResponse.expiresAt).getTime() > new Date(refreshCutoffIso).getTime()) {
    return { kind: 'ok', ...existingResponse };
  }

  // Revoking before insertion keeps the partial unique index on live tokens
  // true even when several historical rows are retained for audit.
  const { error: revokeError } = await admin
    .from('member_identity_tokens')
    .update({ revoked_at: nowIso })
    .eq('member_profile_id', member.id)
    .is('revoked_at', null);

  if (revokeError) return { kind: 'error', error: revokeError };

  const minted = await mintToken();
  if (!minted?.raw || !minted?.hash) {
    throw new TypeError('mintToken must return raw and hash values');
  }

  const { error: insertError } = await admin
    .from('member_identity_tokens')
    .insert({
      member_profile_id: member.id,
      token_hash: minted.hash,
      token_raw: minted.raw,
      issued_at: nowIso,
      expires_at: expiresAtIso,
      revoked_at: null,
    });

  if (insertError) {
    // A concurrent refresh can win the partial-unique race. Return its token
    // rather than surface an avoidable 500 to the mobile app.
    const { data: concurrent, error: concurrentError } = await admin
      .from('member_identity_tokens')
      .select('token_raw, expires_at, issued_at')
      .eq('member_profile_id', member.id)
      .is('revoked_at', null)
      .gt('expires_at', nowIso)
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const concurrentResponse = concurrentError ? null : responseFor(concurrent);
    if (concurrentResponse) return { kind: 'ok', ...concurrentResponse };
    return { kind: 'error', error: insertError };
  }

  return {
    kind: 'ok',
    token: minted.raw,
    expiresAt: expiresAtIso,
    issuedAt: nowIso,
  };
}

export const memberIdentityTokenTiming = Object.freeze({
  refreshWindowMs: REFRESH_WINDOW_MS,
  lifetimeMs: TOKEN_LIFETIME_MS,
});
