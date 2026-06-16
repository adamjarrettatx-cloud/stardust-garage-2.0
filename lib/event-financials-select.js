// Pure, dependency-free contract-selection logic for the event financials
// loader. Kept in its own module (no `@/` aliased imports) so it can be unit
// tested under the Node test runner without a DB or Next's path resolver.

// Terminal-but-dead statuses whose terms must never drive the split unless they
// are the only thing available. `signed` is terminal too but is the *preferred*
// outcome, so it is handled separately below.
const DEAD_STATUSES = new Set(['declined', 'void', 'expired']);

// Pure selection over contracts linked to an event, expecting `linked` already
// ordered newest-first (updated_at desc). Preference order:
//   1. the most recent fully-signed contract;
//   2. else the most recent non-dead (not declined/void/expired) contract;
//   3. else, as a last resort, the most recent contract of any status.
// We deliberately do NOT order by status (which alphabetized `declined` to the
// front and could let a declined contract win over a live draft).
export function pickContractForSplit(linked) {
  if (!Array.isArray(linked) || linked.length === 0) return null;
  return (
    linked.find((c) => c && c.status === 'signed') ||
    linked.find((c) => c && !DEAD_STATUSES.has(c.status)) ||
    linked[0]
  );
}
