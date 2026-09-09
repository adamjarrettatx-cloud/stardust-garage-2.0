// Server-side issuance policy for mobile Member ID tokens.
//
// The database retains only SHA-256 token hashes. A raw credential can
// therefore be returned only in the response that minted it; it can never be
// recovered from an existing row. Every request intentionally replaces the
// prior live credential, which also makes a lost browser URL short-lived.

const TOKEN_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;

function asValidDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Issues a fresh Member ID credential for the selected member. `requireActive`
// is true for the mobile endpoint; the signed-in badge page permits an inactive
// member to display their badge so staff can inspect its inactive status.
export async function getOrIssueMemberIdentityToken({
  admin,
  userId,
  now = new Date(),
  mintToken,
  requireActive = true,
}) {
  const nowDate = asValidDate(now);
  if (!nowDate) throw new TypeError('now must be a valid date');
  if (typeof mintToken !== 'function') throw new TypeError('mintToken must be a function');

  const nowIso = nowDate.toISOString();
  const expiresAtIso = new Date(nowDate.getTime() + TOKEN_LIFETIME_MS).toISOString();

  const { data: member, error: memberError } = await admin
    .from('member_profiles')
    .select('id, is_active')
    .eq('user_id', userId)
    .maybeSingle();

  if (memberError) return { kind: 'error', error: memberError };
  if (!member?.id || (requireActive && member.is_active !== true)) return { kind: 'not_a_member' };

  // A raw token cannot be reconstructed from its hash, so revoke all live
  // credentials before minting the only raw value the caller will receive.
  const { error: revokeError } = await admin
    .from('member_identity_tokens')
    .update({ revoked_at: nowIso, rotated_at: nowIso })
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
      issued_at: nowIso,
      expires_at: expiresAtIso,
      revoked_at: null,
    });

  if (insertError) return { kind: 'error', error: insertError };

  return {
    kind: 'ok',
    token: minted.raw,
    expiresAt: expiresAtIso,
    issuedAt: nowIso,
  };
}

export const memberIdentityTokenTiming = Object.freeze({
  lifetimeMs: TOKEN_LIFETIME_MS,
});
