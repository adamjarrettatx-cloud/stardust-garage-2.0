// ---------------------------------------------------------------------------
// Team Chat message entities — @user mentions and #event links
// ---------------------------------------------------------------------------
//
// Pure helpers. No I/O, no React, no Supabase — everything here is a function of
// its arguments, which is what lets tests/chat-entities.test.mjs cover the
// fiddly parts (offset math, trigger detection, malformed metadata) without a
// browser or a database.
//
// THE MODEL
//
// A sent message stores the sentence exactly as it reads on screen:
//
//   body_text: "Is the event Mr. Untz already locked in on contract for Naish"
//   entities:  [ { type: 'event', id: '…', label: 'Mr. Untz', start: 13, end: 21 },
//               { type: 'user',  id: '…', label: 'Naish',    start: 56, end: 61 } ]
//
// The @ and # are typing affordances, not content: they are gone by the time
// anything is stored, so the message reads like normal English and a reader
// never has to decode syntax. What makes it more than text replacement is that
// `id` is a real database id and `label` is only a fallback — renderers resolve
// the id against live data first, so an event renamed next month still links,
// and a mention still points at the right person after they change their name.
//
// Offsets are UTF-16 code unit indices into body_text — the same units
// String.prototype.slice and a textarea's selectionStart use — so a segment is
// always exactly body_text.slice(start, end) with no conversion anywhere.
//
// EVERY function below treats `entities` as untrusted. It arrives from a jsonb
// column that other clients (and older versions of this app) also write, so
// "the offsets are stale/overlapping/out of range" is a normal case to handle,
// never a crash.

/** @typedef {'user' | 'event'} MessageEntityType */

/**
 * @typedef {Object} MessageEntity
 * @property {MessageEntityType} type
 * @property {string} id     Real database id — team_members.user_id, or events.id.
 * @property {string} label  Text as it appeared when sent. Fallback only.
 * @property {number} start  Inclusive UTF-16 offset into body_text.
 * @property {number} end    Exclusive UTF-16 offset into body_text.
 */

/**
 * @typedef {Object} ChatMessageEntities
 * @property {string} body_text
 * @property {MessageEntity[]} entities
 * @property {string[]} mentioned_user_ids
 * @property {string[]} linked_event_ids
 */

export const ENTITY_TYPES = ['user', 'event'];

// The character that opens each autocomplete. Exported so the composer, the
// tests and any future surface agree rather than each hardcoding '@'.
export const ENTITY_TRIGGERS = { '@': 'user', '#': 'event' };

// How far back from the caret a trigger may sit. Event titles have spaces
// ("Mr. Untz", "Kava Sunday Social"), so the query cannot simply stop at the
// first space — but without a ceiling, a '#' typed an hour ago would keep
// hijacking every keystroke to the end of the paragraph. 48 characters
// comfortably clears the longest real event title while keeping a stale trigger
// from following the caret forever.
export const TRIGGER_MAX_QUERY_LENGTH = 48;

// A trigger only counts at the start of a word. Without this, an email address
// (adam@sdgatx.com) or a CSS colour (#141414) would open a dropdown mid-word.
function isWordBoundary(ch) {
  return ch === undefined || /[\s(["'“‘\-–—]/.test(ch);
}

/**
 * Find the trigger the caret is currently inside, if any.
 *
 * Scans backwards from the caret for the nearest '@' or '#' that sits on a word
 * boundary, stopping at a newline (a trigger never spans lines) or once
 * TRIGGER_MAX_QUERY_LENGTH characters have been passed. Returns null when the
 * caret is not in a trigger, which is the common case on most keystrokes.
 *
 * `start` is the index of the trigger character itself, `end` is the caret —
 * together they are the span that gets replaced when a result is chosen.
 *
 * @param {string} text
 * @param {number} caret
 * @param {MessageEntity[]} [entities] Existing entities; the caret being inside
 *   one means the user is editing a token, not opening a new trigger.
 * @returns {{ type: MessageEntityType, query: string, start: number, end: number } | null}
 */
export function findActiveTrigger(text, caret, entities = []) {
  const body = typeof text === 'string' ? text : '';
  const at = Number.isInteger(caret) ? Math.max(0, Math.min(caret, body.length)) : body.length;

  for (let i = at - 1; i >= 0 && at - i <= TRIGGER_MAX_QUERY_LENGTH; i -= 1) {
    const ch = body[i];
    if (ch === '\n') return null;

    const type = ENTITY_TRIGGERS[ch];
    if (!type) continue;
    if (!isWordBoundary(body[i - 1])) return null;

    // A trigger character that landed inside an already-resolved token is part
    // of that token's label (an event literally titled "#1 Night"), not a new
    // search.
    if (entityAt(entities, i) || entityAt(entities, at)) return null;

    return { type, query: body.slice(i + 1, at), start: i, end: at };
  }

  return null;
}

/**
 * The entity covering a given offset, or null. `offset` is treated as a caret
 * position, so an entity is "covering" it only when the caret is strictly
 * inside — sitting at either edge means the caret is adjacent to the token, not
 * within it, which is what lets you type immediately before or after one.
 *
 * @param {MessageEntity[]} entities
 * @param {number} offset
 * @returns {MessageEntity | null}
 */
export function entityAt(entities, offset) {
  for (const e of entities || []) {
    if (offset > e.start && offset < e.end) return e;
  }
  return null;
}

/**
 * The entity that ends exactly at `offset`. Used by the composer's Backspace
 * handling: a token deletes whole rather than losing its last letter and
 * quietly becoming a broken half-reference.
 *
 * @param {MessageEntity[]} entities
 * @param {number} offset
 * @returns {MessageEntity | null}
 */
export function entityEndingAt(entities, offset) {
  for (const e of entities || []) {
    if (e.end === offset) return e;
  }
  return null;
}

/**
 * The entity that starts exactly at `offset` — the Delete-key counterpart of
 * entityEndingAt.
 *
 * @param {MessageEntity[]} entities
 * @param {number} offset
 * @returns {MessageEntity | null}
 */
export function entityStartingAt(entities, offset) {
  for (const e of entities || []) {
    if (e.start === offset) return e;
  }
  return null;
}

/**
 * Replace an active trigger with a chosen result, producing the next composer
 * state.
 *
 * The trigger character is dropped, so the text reads as a sentence. A single
 * space is appended when the caret would otherwise land flush against the next
 * word, because the overwhelmingly common next action is to keep typing.
 *
 * @param {Object} args
 * @param {string} args.text
 * @param {MessageEntity[]} args.entities
 * @param {{ start: number, end: number }} args.trigger
 * @param {{ type: MessageEntityType, id: string, label: string }} args.selection
 * @returns {{ text: string, entities: MessageEntity[], caret: number }}
 */
export function insertEntity({ text, entities, trigger, selection }) {
  const body = typeof text === 'string' ? text : '';
  const start = Math.max(0, Math.min(trigger.start, body.length));
  const end = Math.max(start, Math.min(trigger.end, body.length));

  const label = String(selection.label ?? '').replace(/\s+/g, ' ').trim() || 'Untitled';
  const after = body.slice(end);
  const needsSpace = after.length === 0 || !/^\s/.test(after);
  const inserted = needsSpace ? `${label} ` : label;

  const nextText = body.slice(0, start) + inserted + after;
  const delta = inserted.length - (end - start);

  const shifted = (entities || [])
    // An entity that overlapped the replaced span is gone with it.
    .filter((e) => e.end <= start || e.start >= end)
    .map((e) => (e.start >= end ? { ...e, start: e.start + delta, end: e.end + delta } : e));

  shifted.push({
    type: selection.type,
    id: String(selection.id),
    label,
    start,
    end: start + label.length,
  });

  return {
    text: nextText,
    entities: sortEntities(shifted),
    caret: start + inserted.length,
  };
}

/**
 * Remap entity offsets across an arbitrary text edit.
 *
 * The composer is a plain controlled textarea, so an edit arrives as nothing
 * more than "the value used to be X and is now Y" — no ranges, no operations.
 * Native editing (typing, paste, cut, undo, autocorrect, mobile IME, swipe
 * delete) all funnel through here, which is precisely why this is a diff rather
 * than a pile of per-key handlers.
 *
 * The diff is the shortest replaced span: common prefix and common suffix are
 * peeled off, leaving one changed range. An entity whose span overlaps that
 * range is dropped — a token whose letters were edited is no longer a faithful
 * reference to a database row, so it becomes ordinary text instead of silently
 * pointing somewhere the words no longer say. Entities entirely after the range
 * shift by the length delta.
 *
 * @param {string} prevText
 * @param {string} nextText
 * @param {MessageEntity[]} entities
 * @returns {MessageEntity[]}
 */
export function remapEntities(prevText, nextText, entities) {
  const before = typeof prevText === 'string' ? prevText : '';
  const after = typeof nextText === 'string' ? nextText : '';
  const list = entities || [];
  if (list.length === 0 || before === after) return sortEntities(list);

  let prefix = 0;
  const maxPrefix = Math.min(before.length, after.length);
  while (prefix < maxPrefix && before[prefix] === after[prefix]) prefix += 1;

  let suffix = 0;
  const maxSuffix = Math.min(before.length - prefix, after.length - prefix);
  while (
    suffix < maxSuffix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const removedStart = prefix;
  const removedEnd = before.length - suffix;
  const delta = after.length - before.length;

  const remapped = [];
  for (const e of list) {
    // Untouched, entirely before the edit.
    if (e.end <= removedStart) {
      remapped.push(e);
      continue;
    }
    // Untouched, entirely after the edit — shift by the length change.
    if (e.start >= removedEnd) {
      remapped.push({ ...e, start: e.start + delta, end: e.end + delta });
      continue;
    }
    // Overlapped by the edit: the token's own text changed, so it stops being a
    // token. Pure insertion at a token's boundary is not an overlap and is
    // handled by the two branches above.
  }

  return sortEntities(remapped.filter((e) => e.start >= 0 && e.end <= after.length && e.end > e.start));
}

/**
 * Remove one entity and the text it covers — the whole-token delete used by
 * Backspace/Delete at a token edge and by clicking a token's ✕.
 *
 * Also swallows a single space left dangling immediately after the removed
 * token, so deleting a mention out of the middle of a sentence does not leave a
 * double space behind.
 *
 * @param {Object} args
 * @param {string} args.text
 * @param {MessageEntity[]} args.entities
 * @param {MessageEntity} args.entity
 * @returns {{ text: string, entities: MessageEntity[], caret: number }}
 */
export function removeEntity({ text, entities, entity }) {
  const body = typeof text === 'string' ? text : '';
  const start = Math.max(0, Math.min(entity.start, body.length));
  let end = Math.max(start, Math.min(entity.end, body.length));

  if (body[end] === ' ' && (start === 0 || body[start - 1] === ' ' || body[start - 1] === undefined)) {
    end += 1;
  }

  const nextText = body.slice(0, start) + body.slice(end);
  const removedLength = end - start;

  const kept = (entities || [])
    .filter((e) => !(e.start === entity.start && e.end === entity.end && e.id === entity.id))
    .filter((e) => e.end <= start || e.start >= end)
    .map((e) => (e.start >= end ? { ...e, start: e.start - removedLength, end: e.end - removedLength } : e));

  return { text: nextText, entities: sortEntities(kept), caret: start };
}

/**
 * Sort by start offset and drop overlaps, keeping the earlier entity. Called at
 * the end of every mutation so downstream code can assume ordered,
 * non-overlapping spans and never has to sort defensively.
 *
 * @param {MessageEntity[]} entities
 * @returns {MessageEntity[]}
 */
export function sortEntities(entities) {
  const sorted = [...(entities || [])].sort((a, b) => a.start - b.start || a.end - b.end);
  const out = [];
  let cursor = -1;
  for (const e of sorted) {
    if (e.start < cursor) continue;
    out.push(e);
    cursor = e.end;
  }
  return out;
}

/**
 * Coerce whatever came out of the `entities` jsonb column into entities that are
 * safe to render against `bodyText`.
 *
 * Anything that would break rendering is discarded rather than repaired:
 * unknown types, missing ids, non-integer or inverted offsets, offsets past the
 * end of the body, and overlaps. The reason to be this strict is the failure
 * mode — a message whose metadata went stale must still render its text, and it
 * always can, because dropping an entity only costs a link, never a word.
 *
 * @param {unknown} raw
 * @param {string} bodyText
 * @returns {MessageEntity[]}
 */
export function normalizeEntities(raw, bodyText = '') {
  const body = typeof bodyText === 'string' ? bodyText : '';
  let list = raw;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];

  const cleaned = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const { type, id } = item;
    if (!ENTITY_TYPES.includes(type)) continue;
    if (typeof id !== 'string' || id.length === 0) continue;

    const start = Number(item.start);
    const end = Number(item.end);
    if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
    if (start < 0 || end <= start || end > body.length) continue;

    // The stored label is the fallback for a row that has since disappeared. If
    // it is missing, the body text under the span is a better fallback than
    // nothing, and by construction they are normally identical.
    const label = typeof item.label === 'string' && item.label.trim()
      ? item.label
      : body.slice(start, end);

    cleaned.push({ type, id, label, start, end });
  }

  return sortEntities(cleaned);
}

/**
 * Split a message into the ordered runs a renderer walks: plain text and entity
 * spans, covering the body exactly once with no gaps.
 *
 * Concatenating every segment's text always reproduces `bodyText`, whatever
 * state the metadata is in — that invariant is the whole point, and it is what
 * makes a broken token impossible to render.
 *
 * @param {string} bodyText
 * @param {unknown} rawEntities
 * @returns {Array<{ kind: 'text', text: string } | { kind: 'user' | 'event', text: string, entity: MessageEntity }>}
 */
export function segmentMessage(bodyText, rawEntities) {
  const body = typeof bodyText === 'string' ? bodyText : '';
  const entities = normalizeEntities(rawEntities, body);

  const segments = [];
  let cursor = 0;
  for (const e of entities) {
    if (e.start > cursor) segments.push({ kind: 'text', text: body.slice(cursor, e.start) });
    segments.push({ kind: e.type, text: body.slice(e.start, e.end), entity: e });
    cursor = e.end;
  }
  if (cursor < body.length) segments.push({ kind: 'text', text: body.slice(cursor) });
  return segments;
}

/**
 * Flattened id arrays for a draft, matching what the database derives on insert
 * (see chat_messages_flatten_entities in the migration). The client sends these
 * for an optimistic render only — the trigger recomputes both, so a client that
 * lied about them is corrected before the row lands.
 *
 * @param {MessageEntity[]} entities
 * @returns {{ mentioned_user_ids: string[], linked_event_ids: string[] }}
 */
export function flattenEntityIds(entities) {
  const users = new Set();
  const events = new Set();
  for (const e of entities || []) {
    if (e.type === 'user' && e.id) users.add(e.id);
    if (e.type === 'event' && e.id) events.add(e.id);
  }
  return { mentioned_user_ids: [...users], linked_event_ids: [...events] };
}

/**
 * Trim a draft for sending, moving the entity offsets with it.
 *
 * The composer sends `body.trim()` (the existing chat has always trimmed, and
 * the chat_messages_body_check constraint requires a non-blank body), and every
 * offset is an index into that string. Trimming without shifting would silently
 * slide every token left by however much leading whitespace there was, which is
 * the classic way this kind of feature ends up linking the wrong words.
 *
 * @param {string} text
 * @param {MessageEntity[]} entities
 * @returns {{ body: string, entities: MessageEntity[] }}
 */
export function trimBodyWithEntities(text, entities) {
  const body = typeof text === 'string' ? text : '';
  const leading = body.length - body.trimStart().length;
  const trimmed = body.trim();

  const shifted = [];
  for (const e of entities || []) {
    const start = e.start - leading;
    const end = e.end - leading;
    // An entity that fell entirely inside the trimmed whitespace, or that now
    // hangs off either end, is dropped rather than clamped: a clamped span would
    // claim to cover text it does not.
    if (start < 0 || end > trimmed.length || end <= start) continue;
    shifted.push({ ...e, start, end });
  }

  return { body: trimmed, entities: sortEntities(shifted) };
}

/** @param {{ mentioned_user_ids?: string[] }} message @param {string} userId */
export function messageMentionsUser(message, userId) {
  if (!message || !userId) return false;
  return (message.mentioned_user_ids || []).includes(userId);
}

// ---------------------------------------------------------------------------
// Autocomplete search
// ---------------------------------------------------------------------------

/**
 * Normalize for matching: casefold, strip accents, collapse whitespace, and
 * drop punctuation. "Mr. Untz", "mr untz" and "MR.  UNTZ" all reduce to the
 * same key, which is what makes typing #mr untz find an event actually titled
 * "Mr. Untz".
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeForSearch(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Match quality, best first. The ordering matters more than it looks: a staff
// member types two or three characters and expects the obvious person at the
// top, so an exact or prefix hit must always outrank a substring buried in
// somebody's email address.
const RANK_EXACT = 0;
const RANK_PREFIX = 1;
const RANK_WORD_PREFIX = 2;
const RANK_SUBSTRING = 3;
const RANK_INITIALS = 4;
const RANK_NONE = null;

/**
 * How well `haystack` matches `needle`, or null for no match.
 *
 * @param {string} haystack Already normalized.
 * @param {string} needle   Already normalized.
 * @returns {number | null}
 */
export function matchRank(haystack, needle) {
  if (!needle) return RANK_PREFIX;
  if (!haystack) return RANK_NONE;
  if (haystack === needle) return RANK_EXACT;
  if (haystack.startsWith(needle)) return RANK_PREFIX;

  const words = haystack.split(' ');
  if (words.some((w) => w.startsWith(needle))) return RANK_WORD_PREFIX;
  if (haystack.includes(needle)) return RANK_SUBSTRING;

  // "jk" finding "Jeyu Kulpath". Only for short queries — at three or more
  // characters an initials match is almost always a coincidence.
  if (needle.length <= 3 && words.length > 1) {
    const initials = words.map((w) => w[0]).join('');
    if (initials.startsWith(needle)) return RANK_INITIALS;
  }

  return RANK_NONE;
}

/**
 * Rank team members for the @ dropdown.
 *
 * `candidates` is the caller's own mentionable set, assembled by the caller from
 * data it was already allowed to read (the channel roster ∩ the team roster) —
 * this function does no permission work and must never be handed anyone the
 * viewer cannot see. Mentioning someone outside the conversation would notify
 * nobody anyway, since the fan-out trigger intersects with channel membership.
 *
 * Name matches beat email matches, so typing "adam" does not surface somebody
 * whose address merely contains it. Email is searched at all because two people
 * named Alex are otherwise indistinguishable.
 *
 * @param {Array<{ user_id: string, full_name?: string|null, email?: string|null, role?: string|null }>} candidates
 * @param {string} query
 * @param {number} [limit]
 * @returns {Array<{ user_id: string, full_name?: string|null, email?: string|null, role?: string|null }>}
 */
export function searchUserCandidates(candidates, query, limit = 8) {
  const needle = normalizeForSearch(query);
  const scored = [];

  for (const c of candidates || []) {
    if (!c?.user_id) continue;
    const name = normalizeForSearch(c.full_name);
    const email = normalizeForSearch(c.email);
    const localPart = normalizeForSearch(String(c.email || '').split('@')[0]);

    const nameRank = matchRank(name, needle);
    const localRank = matchRank(localPart, needle);
    const emailRank = matchRank(email, needle);

    // +10 keeps every email match below every name match rather than letting
    // an exact email hit jump over a prefix name hit.
    const ranks = [nameRank, localRank == null ? null : localRank + 10, emailRank == null ? null : emailRank + 10]
      .filter((r) => r != null);
    if (ranks.length === 0) continue;

    scored.push({ candidate: c, rank: Math.min(...ranks), label: c.full_name || c.email || '' });
  }

  scored.sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label));
  return scored.slice(0, limit).map((s) => s.candidate);
}

/**
 * Days from today to an event's date — the recency signal the # dropdown sorts
 * on. Negative for past events. `todayIso` is passed in rather than read from
 * the clock so this stays pure and testable.
 *
 * @param {string | null | undefined} eventDate  'YYYY-MM-DD'
 * @param {string} todayIso                      'YYYY-MM-DD'
 * @returns {number | null}
 */
export function daysFromToday(eventDate, todayIso) {
  if (!eventDate || !todayIso) return null;
  const a = Date.parse(`${String(eventDate).slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(todayIso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / 86400000);
}

/**
 * Rank events for the # dropdown.
 *
 * Relevance beats chronology, then chronology breaks ties the way an operations
 * team thinks about it: the thing coming up next, then the thing that just
 * happened, then further out, then further back. Somebody asking whether
 * "#Mr. Untz" is under contract means this Saturday's Mr. Untz, not the one
 * eighteen months ago.
 *
 * @param {Array<{ id: string, title?: string|null, event_date?: string|null, status?: string|null, visibility?: string|null }>} events
 * @param {string} query
 * @param {Object} [opts]
 * @param {string} [opts.todayIso]
 * @param {number} [opts.limit]
 * @returns {Array<object>}
 */
export function searchEventCandidates(events, query, { todayIso = null, limit = 8 } = {}) {
  const needle = normalizeForSearch(query);
  const scored = [];

  for (const e of events || []) {
    if (!e?.id) continue;
    const rank = matchRank(normalizeForSearch(e.title), needle);
    if (rank == null) continue;

    const offset = daysFromToday(e.event_date, todayIso);
    // Upcoming (>= 0) sorts by how soon; past sorts by how recent, always after
    // every upcoming event. A dateless event goes last — it can't be "soon".
    let chronology;
    if (offset == null) chronology = Number.MAX_SAFE_INTEGER;
    else if (offset >= 0) chronology = offset;
    else chronology = 1000000 - offset;

    scored.push({ event: e, rank, chronology, title: e.title || '' });
  }

  scored.sort((a, b) => a.rank - b.rank || a.chronology - b.chronology || a.title.localeCompare(b.title));
  return scored.slice(0, limit).map((s) => s.event);
}

/**
 * The disambiguating line under an event title in the dropdown: its date and,
 * when it isn't a published public event, its status.
 *
 * Two events called "Kava Sunday Social" are the normal case for a recurring
 * night, so the date is not decoration — without it the dropdown is a coin
 * flip. `null` is never returned; there is always at least a dash to render.
 *
 * @param {{ event_date?: string|null, status?: string|null, visibility?: string|null }} event
 * @returns {string}
 */
export function eventContextLabel(event) {
  if (!event) return '';
  const parts = [];

  const date = String(event.event_date || '').slice(0, 10);
  if (date) {
    const parsed = Date.parse(`${date}T12:00:00Z`);
    parts.push(
      Number.isNaN(parsed)
        ? date
        : new Intl.DateTimeFormat('en-US', {
            timeZone: 'UTC',
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          }).format(new Date(parsed))
    );
  } else {
    parts.push('No date');
  }

  const status = String(event.status || '').trim();
  if (status && status !== 'published') parts.push(status.replace(/_/g, ' '));

  const visibility = String(event.visibility || '').trim();
  if (visibility && visibility !== 'public') parts.push(visibility.replace(/_/g, ' '));

  return parts.join(' · ');
}

/**
 * The disambiguating line under a person's name: their role, and their email
 * when a role alone would not tell two people apart.
 *
 * @param {{ full_name?: string|null, email?: string|null, role?: string|null }} member
 * @param {Object} [opts]
 * @param {boolean} [opts.showEmail] Force the email in — the caller sets this
 *   when another candidate in the same list shares this display name.
 * @returns {string}
 */
export function userContextLabel(member, { showEmail = false } = {}) {
  if (!member) return '';
  const parts = [];
  const role = String(member.role || '').trim();
  if (role) parts.push(role === 'admin' ? 'Admin' : role.charAt(0).toUpperCase() + role.slice(1));
  const email = String(member.email || '').trim();
  if (email && (showEmail || parts.length === 0)) parts.push(email);
  return parts.join(' · ');
}

/**
 * Which display names appear more than once in a candidate list. The dropdown
 * uses this to force the email in for exactly those rows, so two people called
 * Alex Rivera are told apart without cluttering every other row.
 *
 * @param {Array<{ full_name?: string|null, email?: string|null }>} candidates
 * @returns {Set<string>}
 */
export function duplicateDisplayNames(candidates) {
  const seen = new Map();
  for (const c of candidates || []) {
    const key = normalizeForSearch(c?.full_name || c?.email);
    if (!key) continue;
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k));
}

/**
 * Initials for the dropdown's avatar fallback. team_members carries no photo
 * column today, so this is what an avatar actually is for a teammate; the
 * dropdown still prefers a real image when one is available.
 *
 * @param {{ full_name?: string|null, email?: string|null }} member
 * @returns {string}
 */
export function memberInitials(member) {
  const source = String(member?.full_name || '').trim() || String(member?.email || '').split('@')[0] || '';
  const words = source.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/**
 * Resolve the text to show for an entity at render time.
 *
 * Live data wins, so a renamed event or a teammate who changed their name reads
 * correctly in every message that ever referenced them — that is the entire
 * reason ids are stored instead of labels. The stored label is the fallback when
 * the row is gone (deleted event, removed teammate), and it renders as plain
 * styled text rather than a dead link.
 *
 * @param {MessageEntity} entity
 * @param {Object} lookups
 * @param {Record<string, { title?: string|null }>} [lookups.eventsById]
 * @param {Record<string, { full_name?: string|null, email?: string|null }>} [lookups.usersByUserId]
 * @returns {{ label: string, resolved: boolean, record: object | null }}
 */
export function resolveEntityLabel(entity, { eventsById = {}, usersByUserId = {} } = {}) {
  const fallback = String(entity?.label ?? '').trim() || 'Unknown';
  if (!entity?.id) return { label: fallback, resolved: false, record: null };

  if (entity.type === 'event') {
    const record = eventsById[entity.id];
    const title = String(record?.title ?? '').trim();
    return { label: title || fallback, resolved: Boolean(record), record: record || null };
  }

  const record = usersByUserId[entity.id];
  const name = String(record?.full_name ?? '').trim() || String(record?.email ?? '').trim();
  return { label: name || fallback, resolved: Boolean(record), record: record || null };
}
