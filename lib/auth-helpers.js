import { createClient } from '@/lib/supabase/server';

// Server-side helper. Returns the current user along with a derived
// `isAdmin` flag and the raw team role.
//
// SECURITY: `isAdmin` is sourced from the server-controlled `team_members`
// table (role = 'admin'), NOT from `user_metadata.is_admin`. Per Supabase
// advisor 0015, user_metadata is editable by end users and must not be used
// in a security context. The middleware still falls back to user_metadata
// for the broad gate so we don't break existing pages, but every sensitive
// path MUST call requireAdmin() / requireTeam() which use team_members.
export async function getCurrentUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { user: null, isAdmin: false, teamRole: null };
  }

  // Source of truth: team_members.role
  const { data: tm } = await supabase
    .from('team_members')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();

  const teamRole = tm?.role || null;
  const isAdmin = teamRole === 'admin';
  return { user, isAdmin, teamRole };
}

// Hard gate for admin-only API routes. Returns { unauthorized: true } when the
// caller is not an admin per team_members. Always prefer this over reading
// user_metadata.is_admin in a route handler.
export async function requireAdmin() {
  const { user, isAdmin } = await getCurrentUser();
  if (!user || !isAdmin) {
    return { user: null, isAdmin: false, unauthorized: true };
  }
  return { user, isAdmin: true, unauthorized: false };
}

// Hard gate for routes that any team member (team OR admin) may use.
export async function requireTeam() {
  const { user, isAdmin, teamRole } = await getCurrentUser();
  if (!user || (teamRole !== 'team' && teamRole !== 'admin')) {
    return { user: null, isAdmin: false, teamRole: null, unauthorized: true };
  }
  return { user, isAdmin, teamRole, unauthorized: false };
}

// ---------------------------------------------------------------------------
// MFA readiness layer
// ---------------------------------------------------------------------------
//
// Supabase Auth exposes Authenticator Assurance Levels (AAL):
//   - aal1: password (single factor)
//   - aal2: password + a verified TOTP factor
//
// getMfaStatus() inspects the current session WITHOUT enforcing anything, so
// callers can surface enrollment prompts and we can roll MFA out gradually.
// Enforcement is intentionally NOT wired into the request path yet — see
// requireAdminMfa() below, which is a guarded opt-in controlled by the
// ENFORCE_ADMIN_MFA env flag. This keeps us honest: MFA is scaffolded and
// fully usable for enrollment, but NOT silently pretended to be enforced.
//
// Relevant Supabase client methods (used by the UI / future enforcement):
//   supabase.auth.mfa.enroll({ factorType: 'totp' })
//   supabase.auth.mfa.challenge({ factorId })
//   supabase.auth.mfa.verify({ factorId, challengeId, code })
//   supabase.auth.mfa.listFactors()
//   supabase.auth.mfa.getAuthenticatorAssuranceLevel()

// Returns a plain MFA status object for the current user. Never throws.
//   { currentLevel, nextLevel, hasVerifiedFactor, mfaSatisfied }
// `mfaSatisfied` is true when the session has actually stepped up to aal2.
export async function getMfaStatus() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return {
      user: null,
      currentLevel: null,
      nextLevel: null,
      hasVerifiedFactor: false,
      mfaSatisfied: false,
    };
  }

  let currentLevel = null;
  let nextLevel = null;
  try {
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    currentLevel = data?.currentLevel ?? null;
    nextLevel = data?.nextLevel ?? null;
  } catch {
    // MFA API unavailable (e.g. stub client) — treat as no factors.
  }

  let hasVerifiedFactor = false;
  try {
    const { data } = await supabase.auth.mfa.listFactors();
    hasVerifiedFactor = (data?.totp || []).some((f) => f.status === 'verified');
  } catch {
    // ignore
  }

  return {
    user,
    currentLevel,
    nextLevel,
    hasVerifiedFactor,
    // A user "needs to step up" when they have a verified factor and the
    // session is still at aal1 (nextLevel === 'aal2').
    needsStepUp: hasVerifiedFactor && nextLevel === 'aal2' && currentLevel === 'aal1',
    mfaSatisfied: currentLevel === 'aal2',
  };
}

// Returns true when MFA enforcement for admins is switched on. Controlled by
// an env flag so we can dark-launch: scaffold + enrollment ship first, then we
// flip ENFORCE_ADMIN_MFA=true once every admin has enrolled. Until then this
// is false and requireAdminMfa() behaves exactly like requireAdmin().
export function adminMfaEnforced() {
  return process.env.ENFORCE_ADMIN_MFA === 'true';
}

// Hard gate that additionally requires a stepped-up (aal2) session WHEN
// enforcement is enabled. While ENFORCE_ADMIN_MFA is off, this is equivalent
// to requireAdmin() so nothing breaks. When on, an admin without an aal2
// session gets { unauthorized: true, reason: 'mfa_required' } so the caller
// can redirect to the enrollment/challenge UI.
//
// NOTE: This is provided for routes that opt in. It is NOT yet applied to any
// existing route — wiring it in is a deliberate Phase 2 step once admins have
// enrolled, to avoid locking anyone out.
export async function requireAdminMfa() {
  const base = await requireAdmin();
  if (base.unauthorized) return { ...base, reason: 'not_admin' };
  if (!adminMfaEnforced()) return { ...base, reason: null, mfaSatisfied: false };

  const status = await getMfaStatus();
  if (!status.mfaSatisfied) {
    return { user: null, isAdmin: false, unauthorized: true, reason: 'mfa_required' };
  }
  return { ...base, reason: null, mfaSatisfied: true };
}
