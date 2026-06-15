// Pure, dependency-free helpers for the capacity counter. Kept free of any
// Supabase / React imports so they can be unit-tested under `node --test` and
// reused on both the server (API routes) and client (door pages).

// Visual/UX threshold (fraction of max) at which a door page flips to its
// "near capacity" warning state before hitting full.
export const NEAR_FULL_RATIO = 0.9;

// Valid station labels accepted by the API. Mirrors the CHECK constraint on
// public.capacity_events.source.
export const VALID_SOURCES = ['front_door', 'exit_door', 'admin', 'system', 'unknown'];

export function isValidSource(source) {
  return VALID_SOURCES.includes(source);
}

// Clamp a count into the valid [0, max] window. Used as a client-side mirror of
// the DB clamp so the UI never optimistically renders an impossible number.
export function clampCount(count, max) {
  const n = Number(count);
  const m = Number(max);
  if (!Number.isFinite(n)) return 0;
  if (!Number.isFinite(m) || m <= 0) return Math.max(0, Math.round(n));
  return Math.min(Math.max(0, Math.round(n)), Math.round(m));
}

// Coerce/validate a max_capacity value coming from a form. Returns a positive
// integer or null when invalid, so callers can reject with a clear message.
export function parseMaxCapacity(input) {
  const n = Number(input);
  if (!Number.isInteger(n) || n <= 0 || n > 100000) return null;
  return n;
}

// Derive the door-page status from a session. Returns one of:
//   'empty' | 'open' | 'near' | 'full'
// plus the numbers the UI needs. Safe on a null session (no active night).
export function deriveStatus(session) {
  if (!session) {
    return { status: 'none', count: 0, max: 0, remaining: 0, ratio: 0, atMax: false, atZero: true };
  }
  const max = clampMax(session.max_capacity);
  const count = clampCount(session.current_count, max);
  const remaining = Math.max(0, max - count);
  const ratio = max > 0 ? count / max : 0;
  const atMax = count >= max;
  const atZero = count <= 0;

  let status;
  if (atMax) status = 'full';
  else if (ratio >= NEAR_FULL_RATIO) status = 'near';
  else if (atZero) status = 'empty';
  else status = 'open';

  return { status, count, max, remaining, ratio, atMax, atZero };
}

function clampMax(max) {
  const m = Number(max);
  return Number.isFinite(m) && m > 0 ? Math.round(m) : 0;
}

// Map a Supabase RPC error (PostgREST shape) to a stable, client-safe
// { code, message, httpStatus } so route handlers stay terse and the UI can
// branch on a code instead of parsing prose.
export function mapRpcError(error) {
  const raw = error?.message || '';
  // SQLSTATE is surfaced on error.code by PostgREST for RAISE'd exceptions.
  const sqlstate = error?.code || '';

  if (sqlstate === '42501' || /not authorized/i.test(raw)) {
    return { code: 'forbidden', message: 'Not authorized for this action.', httpStatus: 403 };
  }
  if (sqlstate === 'P0002' || /no active capacity session/i.test(raw)) {
    return { code: 'no_session', message: 'No active session. Start a session first.', httpStatus: 409 };
  }
  if (/at capacity/i.test(raw)) {
    return { code: 'full', message: 'At capacity — check-in blocked.', httpStatus: 409 };
  }
  if (/already empty/i.test(raw)) {
    return { code: 'empty', message: 'Count is already at zero.', httpStatus: 409 };
  }
  if (/max_capacity must be positive/i.test(raw) || sqlstate === '22023') {
    return { code: 'bad_input', message: 'Max capacity must be a positive number.', httpStatus: 400 };
  }
  return { code: 'error', message: raw || 'Unexpected error.', httpStatus: 500 };
}

// The set of allowed write operations, mapped to the RPC name + the role each
// requires. Single source of truth shared by the API route so the dispatch
// table can't drift from the docs.
export const CAPACITY_OPERATIONS = {
  check_in:   { rpc: 'capacity_check_in',   role: 'team',  defaultSource: 'front_door' },
  check_out:  { rpc: 'capacity_check_out',  role: 'team',  defaultSource: 'exit_door' },
  reset:      { rpc: 'capacity_reset',      role: 'team',  defaultSource: 'admin' },
  adjust:     { rpc: 'capacity_adjust',     role: 'admin', defaultSource: 'admin' },
  start:      { rpc: 'capacity_start_session', role: 'admin', defaultSource: 'admin' },
  end:        { rpc: 'capacity_end_session',   role: 'admin', defaultSource: 'admin' },
};
