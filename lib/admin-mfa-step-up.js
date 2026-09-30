// Only return to local admin workspaces. Never accept an external redirect.
export function adminMfaReturnTo(value) {
  if (typeof value !== 'string' || !value.startsWith('/bananas') || value.includes('\\')) return '/bananas';
  try {
    const url = new URL(value, 'https://sdg.invalid');
    if (url.origin !== 'https://sdg.invalid'
      || !/^\/bananas(?:\/|$)/.test(url.pathname)
      || /^\/bananas\/(?:security|login)(?:\/|$)/.test(url.pathname)) return '/bananas';
    return url.pathname + url.search;
  } catch { return '/bananas'; }
}

export async function verifyAdminSecondFactor(supabase, factorId, code) {
  if (!factorId || !/^\d{6}$/.test(code)) throw new Error('Enter the 6-digit code from your authenticator app.');
  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
  if (challengeError || !challenge?.id) throw new Error('Could not start verification. Please try again.');
  const { error: verifyError } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code });
  if (verifyError) throw new Error('Code not accepted. Use the current code from your authenticator app and retry.');
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || data?.currentLevel !== 'aal2') throw new Error('Your session could not be verified. Please retry.');
}
