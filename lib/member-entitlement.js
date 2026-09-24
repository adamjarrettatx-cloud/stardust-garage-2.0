// Pure eligibility check shared by server routes and Edge-safe access helpers.
export function isEntitledMember(member) {
  if (!member || member.is_active !== true) return false;
  const status = String(member.subscription_status || '').toLowerCase();
  return status === 'active' || status === 'trialing';
}
