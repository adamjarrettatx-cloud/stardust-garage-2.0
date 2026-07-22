// Server-only feature flags, read from environment variables so a flag can be
// flipped in the deploy platform (Vercel) without a code change. A flag is OFF
// unless its variable is set to the exact string 'true'; an unset variable means
// OFF. NEVER import this from a client component — pass the resolved boolean down
// as a prop from a server component instead.

// Contract templates + the visual field editor (PR #37). Ships dark: OFF unless
// CONTRACT_TEMPLATES_ENABLED=true is set in the server environment, so the whole
// feature can be switched back on later without any code change.
export function isContractTemplatesEnabled() {
  return process.env.CONTRACT_TEMPLATES_ENABLED === 'true';
}
