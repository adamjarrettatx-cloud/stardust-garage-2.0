import { getCurrentUser, getMfaStatus } from '@/lib/auth-helpers';
import { viewConfig } from './config';

// UUID pinned server-side; other admins and synthetic admin personas fail.
// Unlike the gradual general admin MFA rollout, this gate ALWAYS needs AAL2.
export async function requireViewPortalOwner() {
  const { user, isAdmin } = await getCurrentUser();
  if (!user || !isAdmin || user.id !== process.env.VIEW_PORTAL_OWNER_USER_ID
    || process.env.VIEW_PORTAL_MODE !== 'launcher') {
    return { unauthorized: true, reason: 'not_owner' };
  }
  const mfa = await getMfaStatus();
  if (mfa.user?.id !== user.id || !mfa.mfaSatisfied) return { unauthorized: true, reason: 'mfa_required' };
  return { unauthorized: false, user };
}
export function launchConfig() {
  const config = viewConfig();
  if (config.mode !== 'launcher') throw new Error('Launch is available only from the owner control site');
  return config;
}
