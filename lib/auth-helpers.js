import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/stub';
import { parseBearerToken } from '@/lib/request-auth';
import { canModerateChat } from '@/lib/chat';

// Resolves the authenticated caller of an API route that must serve BOTH the
// website and the mobile app. The website sends a Supabase session cookie; the
// mobile app has no cookie jar and sends `Authorization: Bearer <supabase
// access token>` instead. Returns the auth.users row or null — never throws, so
// callers can answer a uniform 401.
//
// The bearer token is verified by Supabase Auth (getUser calls the auth server),
// so a forged or expired token resolves to null. It is never trusted as an
// identity claim on its own.
export async function getRequestUser(request) {
  const token = parseBearerToken(request.headers.get('authorization'));

  if (token) {
    if (!isSupabaseConfigured()) return null;
    const supabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    const { data, error } = await supabase.auth.getUser(token);
    return error ? null : data?.user || null;
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data?.user || null;
}

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
// Partner gate
// ---------------------------------------------------------------------------
//
// Partners (promoters, collectives, vendors — a contact with a login) are
// deliberately NOT team_members and NOT member_profiles rows. The three roles
// are mutually exclusive: a partner sees public pages, their own profile and
// their guest list, nothing else. Source of truth is partner_profiles.is_active,
// which only /api/portal/complete-activation can set (see the column-level
// grant in 20260729_guest_list_partners.sql).

// Returns { user, partner, isActivePartner }. `partner` is the row from
// public.partner_self() — the partner's own profile plus the two safe columns
// from their contact (display name + relationship type). It is null when the
// caller has no partner invite at all.
export async function getCurrentPartner() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { user: null, partner: null, isActivePartner: false };
  }

  const { data } = await supabase.rpc('partner_self');
  const partner = Array.isArray(data) ? data[0] || null : data || null;

  return { user, partner, isActivePartner: Boolean(partner?.is_active) };
}

// Hard gate for partner-only API routes / server components. An invited partner
// who hasn't finished activation is NOT authorized — they get bounced to
// /portal/activate by the page, not handed guest list access.
export async function requirePartner() {
  const { user, partner, isActivePartner } = await getCurrentPartner();
  if (!user || !isActivePartner) {
    return { user: null, partner: null, isActivePartner: false, unauthorized: true };
  }
  return { user, partner, isActivePartner: true, unauthorized: false };
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

// Page-level gate for admin Server Components. Mirrors the redirect logic the
// existing admin pages already do inline (login when unauthenticated, /member
// when not an admin) and ADDS the MFA-ready step: when ENFORCE_ADMIN_MFA is on
// and the session is not stepped up to aal2, it points the caller at
// /admin/security instead of returning a dead 401. Enrollment/challenge happen
// there, so an admin is guided to fix their session rather than locked out.
//
// Returns { user, isAdmin, redirect }. When `redirect` is a string, the page
// MUST call next/navigation redirect() with it. While enforcement is off this
// never produces an MFA redirect, so behavior is unchanged.
export async function adminPageGate() {
  const { user, isAdmin } = await getCurrentUser();
  if (!user) return { user: null, isAdmin: false, redirect: '/login' };
  if (!isAdmin) return { user, isAdmin: false, redirect: '/member' };

  if (adminMfaEnforced()) {
    const status = await getMfaStatus();
    if (!status.mfaSatisfied) {
      // Send them to Security to enroll (no factor) or step up (has factor).
      return { user, isAdmin: true, redirect: '/bananas/security?mfa=required' };
    }
  }
  return { user, isAdmin: true, redirect: null };
}

// ---------------------------------------------------------------------------
// Owner-level gate
// ---------------------------------------------------------------------------
//
// Some admin pages (Settings, Documents, Analytics) should only be accessible
// to the business owner. This is enforced server-side by checking the signed-in
// user's email against the canonical owner address.
//
// SECURITY: email is sourced from auth.users (server-controlled) via
// supabase.auth.getUser(), NOT from user_metadata — so it cannot be spoofed
// by an end user editing their own metadata.

export const OWNER_EMAIL = 'adam@sdgatx.com';

// Hard gate for owner-only API routes / server actions.
// Returns { user, isOwner: true } or { unauthorized: true }.
export async function requireOwner() {
  const base = await requireAdmin();
  if (base.unauthorized) return { user: null, isOwner: false, unauthorized: true };
  const isOwner = base.user?.email === OWNER_EMAIL;
  if (!isOwner) return { user: base.user, isOwner: false, unauthorized: true };
  return { user: base.user, isOwner: true, unauthorized: false };
}

// Owner-only variant of requireAdminMfa(). Use for API routes that mutate
// privileged records (e.g. team membership) where a non-owner admin must be
// refused even though they pass the admin check. Keeps the MFA step-up
// behaviour of requireAdminMfa() and layers the owner-email check on top.
// Returns { user, isOwner, unauthorized, reason }.
export async function requireOwnerMfa() {
  const base = await requireAdminMfa();
  if (base.unauthorized) return { user: null, isOwner: false, unauthorized: true, reason: base.reason };
  const isOwner = base.user?.email === OWNER_EMAIL;
  if (!isOwner) return { user: base.user, isOwner: false, unauthorized: true, reason: 'not_owner' };
  return { user: base.user, isOwner: true, unauthorized: false, reason: null };
}

// Hard gate for every privileged Team Chat action: creating a channel, deleting
// a message (anyone's, in a channel or a DM) and deleting a channel. Owner-only,
// and deliberately a separate gate from requireOwner(): requireOwner() also
// guards whole-business cash flow, so widening its email set to cover the
// admin@sdgatx.com login would hand that account the financial ledger too. See
// canModerateChat() in lib/chat.js for the identity rule, and
// supabase/migrations/20260829_chat_owner_only_moderation.sql for the DB-level
// stop that holds even when a caller skips these routes entirely.
export async function requireChatChannelAdmin() {
  const { user, teamRole } = await getCurrentUser();
  if (!canModerateChat({ role: teamRole, email: user?.email })) {
    return { user: null, unauthorized: true };
  }
  return { user, unauthorized: false };
}

// Page-level gate for owner-only Server Components.
// Returns { user, isOwner, redirect }.
// When `redirect` is a string, the page MUST call next/navigation redirect() with it.
// Non-owner admins are sent back to /admin instead of leaking any content.
export async function ownerPageGate() {
  const { user, redirect: adminRedirect } = await adminPageGate();
  if (adminRedirect) return { user: null, isOwner: false, redirect: adminRedirect };
  const isOwner = user?.email === OWNER_EMAIL;
  if (!isOwner) return { user, isOwner: false, redirect: '/bananas' };
  return { user, isOwner: true, redirect: null };
}
