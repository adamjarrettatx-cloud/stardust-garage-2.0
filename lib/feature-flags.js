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

// Internal (first-party) ticket sales. Ships dark: OFF unless
// INTERNAL_TICKETING_ENABLED=true. The per-event `events.ticketing_mode`
// column is the fine-grained switch (existing rows stay on 'tickettailor');
// this flag is the hard master kill switch so the whole surface can be
// disabled from Vercel without a code change even if an event was flipped.
export function isInternalTicketingEnabled() {
  return process.env.INTERNAL_TICKETING_ENABLED === 'true';
}

// Member wallet — saved payment methods + purchase history. Depends on the
// internal ticketing flag being on; ships dark on its own until UI is ready.
export function isMemberWalletEnabled() {
  return (
    isInternalTicketingEnabled() &&
    process.env.MEMBER_WALLET_ENABLED === 'true'
  );
}

// In-house door scanner endpoint. Off by default until the scanner UI ships.
export function isTicketScannerEnabled() {
  return process.env.TICKET_SCANNER_ENABLED === 'true';
}
