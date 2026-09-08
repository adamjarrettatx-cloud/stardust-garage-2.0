// Door Session helpers.
//
// A door session is the "shift" during which staff scans guests at the door.
// It binds every scan to a specific event so that:
//   * ticket scans use its event_id
//   * per-shift analytics work
//   * there is no localStorage guesswork about "which event is tonight"
//
// Business rules enforced here (in addition to the DB partial-unique index
// that permits only one open session at a time):
//
//   1. Only one open session may exist across the whole venue.
//   2. Opening requires an event that is public / not in a terminal state.
//   3. Closing is idempotent: closing an already-closed session is a no-op.
//   4. Closing "the active session" always closes whatever session is open,
//      regardless of who opened it (any team member can end the shift).

export const MAX_DOOR_SESSION_NOTES = 500;

// Given a Supabase admin client, returns the single currently-open door
// session (or null). Never throws.
export async function getActiveDoorSession(admin) {
  const { data, error } = await admin
    .from('door_sessions')
    .select('id, event_id, opened_at, opened_by, closed_at, notes')
    .is('closed_at', null)
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data || null;
}

// Verifies an event_id is legal to open a session against. Returns
// { ok: true, event } or { ok: false, error, status }. Rules kept minimal
// so we don't accidentally block staff on the wrong Friday night:
//   * event must exist
//   * event must not be soft-deleted / archived
//   * event may be in the past — a late door for a rescheduled show is fine
export async function loadOpenableEvent(admin, eventId) {
  if (!eventId || typeof eventId !== 'string') {
    return { ok: false, error: 'event_id required', status: 400 };
  }
  const { data: event, error } = await admin
    .from('events')
    .select('id, title, event_date, status')
    .eq('id', eventId)
    .maybeSingle();
  if (error) return { ok: false, error: 'Event lookup failed', status: 500 };
  if (!event) return { ok: false, error: 'Event not found', status: 404 };
  if (event.status === 'archived' || event.status === 'deleted') {
    return { ok: false, error: 'Event is archived', status: 409 };
  }
  return { ok: true, event };
}

// Attempts to open a new door session. Enforces "one open at a time" by
// checking first (fast happy path) and relying on the DB partial-unique
// index as the ultimate race guard.
export async function openDoorSession(admin, { eventId, openedBy, notes }) {
  const existing = await getActiveDoorSession(admin);
  if (existing) {
    return {
      ok: false,
      error: 'A door session is already open. End it before starting a new one.',
      status: 409,
      activeSession: existing,
    };
  }
  const evGate = await loadOpenableEvent(admin, eventId);
  if (!evGate.ok) return evGate;

  const cleanNotes = typeof notes === 'string' ? notes.trim().slice(0, MAX_DOOR_SESSION_NOTES) : '';
  const { data, error } = await admin
    .from('door_sessions')
    .insert({
      event_id: evGate.event.id,
      opened_by: openedBy,
      notes: cleanNotes || null,
    })
    .select('id, event_id, opened_at, opened_by, closed_at, notes')
    .single();

  if (error) {
    // Race: someone else opened one in the meantime.
    if (error.code === '23505') {
      const conflict = await getActiveDoorSession(admin);
      return {
        ok: false,
        error: 'A door session is already open. End it before starting a new one.',
        status: 409,
        activeSession: conflict,
      };
    }
    return { ok: false, error: 'Failed to open door session', status: 500 };
  }

  return { ok: true, session: data, event: evGate.event };
}

// Closes whatever session is currently open. Returns:
//   * { ok: true, session, alreadyClosed: false } — closed it
//   * { ok: true, session: null, alreadyClosed: true } — nothing was open
//   * { ok: false, error, status } — DB failure
export async function closeActiveDoorSession(admin, { closedBy, notes }) {
  const active = await getActiveDoorSession(admin);
  if (!active) return { ok: true, session: null, alreadyClosed: true };

  const patch = { closed_at: new Date().toISOString(), closed_by: closedBy };
  if (typeof notes === 'string' && notes.trim()) {
    // Append rather than clobber any opening note.
    const trailing = notes.trim().slice(0, MAX_DOOR_SESSION_NOTES);
    patch.notes = active.notes ? `${active.notes}\n\n[close] ${trailing}` : `[close] ${trailing}`;
  }

  const { data, error } = await admin
    .from('door_sessions')
    .update(patch)
    .eq('id', active.id)
    .is('closed_at', null)  // idempotent: don't stomp a race-closed row
    .select('id, event_id, opened_at, opened_by, closed_at, closed_by, notes')
    .maybeSingle();

  if (error) return { ok: false, error: 'Failed to close door session', status: 500 };
  if (!data) {
    // Race — someone else closed it between the read and the update.
    return { ok: true, session: null, alreadyClosed: true };
  }
  return { ok: true, session: data, alreadyClosed: false };
}
