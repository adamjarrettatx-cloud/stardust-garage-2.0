import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findActiveTrigger,
  entityAt,
  entityEndingAt,
  entityStartingAt,
  insertEntity,
  remapEntities,
  removeEntity,
  sortEntities,
  normalizeEntities,
  segmentMessage,
  flattenEntityIds,
  trimBodyWithEntities,
  messageMentionsUser,
  normalizeForSearch,
  matchRank,
  searchUserCandidates,
  searchEventCandidates,
  daysFromToday,
  eventContextLabel,
  userContextLabel,
  duplicateDisplayNames,
  memberInitials,
  resolveEntityLabel,
  TRIGGER_MAX_QUERY_LENGTH,
} from '../lib/chat-entities.js';

const EVENT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

// ---------------------------------------------------------------------------
// findActiveTrigger
// ---------------------------------------------------------------------------

test('findActiveTrigger: @ at the start of the text opens a user search', () => {
  const t = findActiveTrigger('@na', 3);
  assert.deepEqual(t, { type: 'user', query: 'na', start: 0, end: 3 });
});

test('findActiveTrigger: # opens an event search', () => {
  const t = findActiveTrigger('is the event #mr', 16);
  assert.equal(t.type, 'event');
  assert.equal(t.query, 'mr');
  assert.equal(t.start, 13);
});

test('findActiveTrigger: an event query may contain spaces', () => {
  const text = 'is the event #Mr. Untz';
  const t = findActiveTrigger(text, text.length);
  assert.equal(t.type, 'event');
  assert.equal(t.query, 'Mr. Untz');
});

test('findActiveTrigger: mid-word @ is an email, not a mention', () => {
  assert.equal(findActiveTrigger('adam@sdgatx', 11), null);
});

test('findActiveTrigger: mid-word # is a hex colour, not an event', () => {
  assert.equal(findActiveTrigger('bg141#41', 8), null);
});

test('findActiveTrigger: a trigger after an opening bracket or quote still counts', () => {
  assert.equal(findActiveTrigger('(@na', 4)?.type, 'user');
  assert.equal(findActiveTrigger('"#mr', 4)?.type, 'event');
});

test('findActiveTrigger: never crosses a newline', () => {
  assert.equal(findActiveTrigger('@naish\nhello', 12), null);
});

test('findActiveTrigger: gives up past the query length ceiling', () => {
  const long = `#${'x'.repeat(TRIGGER_MAX_QUERY_LENGTH + 5)}`;
  assert.equal(findActiveTrigger(long, long.length), null);
});

test('findActiveTrigger: the nearest trigger wins', () => {
  const text = '@naish and #mr';
  const t = findActiveTrigger(text, text.length);
  assert.equal(t.type, 'event');
  assert.equal(t.query, 'mr');
});

test('findActiveTrigger: no trigger returns null', () => {
  assert.equal(findActiveTrigger('just plain text', 15), null);
});

test('findActiveTrigger: caret inside an existing token does not reopen a search', () => {
  // "#1 Night" is a real title; the # is part of the resolved token's label.
  const entities = [{ type: 'event', id: EVENT_ID, label: '#1 Night', start: 3, end: 11 }];
  assert.equal(findActiveTrigger('at #1 Night', 8, entities), null);
});

test('findActiveTrigger: clamps an out-of-range caret instead of throwing', () => {
  assert.equal(findActiveTrigger('@na', 999)?.query, 'na');
  assert.equal(findActiveTrigger('', 0), null);
});

// ---------------------------------------------------------------------------
// entityAt / entityEndingAt / entityStartingAt
// ---------------------------------------------------------------------------

const NAISH = { type: 'user', id: USER_ID, label: 'Naish', start: 4, end: 9 };

test('entityAt: only a caret strictly inside the span counts', () => {
  assert.equal(entityAt([NAISH], 6)?.id, USER_ID);
  assert.equal(entityAt([NAISH], 4), null, 'the leading edge is adjacent, not inside');
  assert.equal(entityAt([NAISH], 9), null, 'the trailing edge is adjacent, not inside');
});

test('entityEndingAt / entityStartingAt: find the token at each edge', () => {
  assert.equal(entityEndingAt([NAISH], 9)?.id, USER_ID);
  assert.equal(entityEndingAt([NAISH], 8), null);
  assert.equal(entityStartingAt([NAISH], 4)?.id, USER_ID);
  assert.equal(entityStartingAt([NAISH], 5), null);
});

// ---------------------------------------------------------------------------
// insertEntity
// ---------------------------------------------------------------------------

test('insertEntity: drops the trigger character and records real offsets', () => {
  const text = 'for @nai';
  const trigger = findActiveTrigger(text, text.length);
  const next = insertEntity({
    text,
    entities: [],
    trigger,
    selection: { type: 'user', id: USER_ID, label: 'Naish' },
  });

  assert.equal(next.text, 'for Naish ');
  assert.deepEqual(next.entities, [
    { type: 'user', id: USER_ID, label: 'Naish', start: 4, end: 9 },
  ]);
  assert.equal(next.caret, 10);
  // The invariant that makes rendering trustworthy.
  assert.equal(next.text.slice(4, 9), 'Naish');
});

test('insertEntity: builds the example sentence end to end', () => {
  let state = { text: 'Is the event #Mr. Unt', entities: [] };
  state = insertEntity({
    ...state,
    trigger: findActiveTrigger(state.text, state.text.length, state.entities),
    selection: { type: 'event', id: EVENT_ID, label: 'Mr. Untz' },
  });
  state.text += 'already locked in on contract for @Nai';
  state = insertEntity({
    ...state,
    trigger: findActiveTrigger(state.text, state.text.length, state.entities),
    selection: { type: 'user', id: USER_ID, label: 'Naish' },
  });

  assert.equal(
    state.text.trim(),
    'Is the event Mr. Untz already locked in on contract for Naish'
  );
  assert.equal(state.entities.length, 2);
  const [event, user] = state.entities;
  assert.equal(state.text.slice(event.start, event.end), 'Mr. Untz');
  assert.equal(state.text.slice(user.start, user.end), 'Naish');
});

test('insertEntity: shifts entities that sit after the insertion point', () => {
  const text = 'ping @na then Mr. Untz';
  const entities = [{ type: 'event', id: EVENT_ID, label: 'Mr. Untz', start: 14, end: 22 }];
  const next = insertEntity({
    text,
    entities,
    trigger: findActiveTrigger(text, 8, entities),
    selection: { type: 'user', id: USER_ID, label: 'Naish' },
  });

  const moved = next.entities.find((e) => e.type === 'event');
  assert.equal(next.text.slice(moved.start, moved.end), 'Mr. Untz');
});

test('insertEntity: adds no second space when one already follows', () => {
  const text = '@na end';
  const next = insertEntity({
    text,
    entities: [],
    trigger: { start: 0, end: 3 },
    selection: { type: 'user', id: USER_ID, label: 'Naish' },
  });
  assert.equal(next.text, 'Naish end');
});

test('insertEntity: collapses whitespace in a label and never inserts an empty one', () => {
  const next = insertEntity({
    text: '#x',
    entities: [],
    trigger: { start: 0, end: 2 },
    selection: { type: 'event', id: EVENT_ID, label: '  Mr.\n  Untz  ' },
  });
  assert.equal(next.text, 'Mr. Untz ');

  const blank = insertEntity({
    text: '#x',
    entities: [],
    trigger: { start: 0, end: 2 },
    selection: { type: 'event', id: EVENT_ID, label: '   ' },
  });
  assert.equal(blank.entities[0].label, 'Untitled');
});

// ---------------------------------------------------------------------------
// remapEntities
// ---------------------------------------------------------------------------

test('remapEntities: typing before a token shifts it', () => {
  const entities = [{ type: 'user', id: USER_ID, label: 'Naish', start: 4, end: 9 }];
  const next = remapEntities('for Naish', 'ping for Naish', entities);
  assert.equal(next.length, 1);
  assert.equal('ping for Naish'.slice(next[0].start, next[0].end), 'Naish');
});

test('remapEntities: typing after a token leaves it alone', () => {
  const entities = [{ type: 'user', id: USER_ID, label: 'Naish', start: 4, end: 9 }];
  const next = remapEntities('for Naish', 'for Naish please', entities);
  assert.deepEqual(next, entities);
});

test('remapEntities: editing a token dissolves it into plain text', () => {
  const entities = [{ type: 'user', id: USER_ID, label: 'Naish', start: 4, end: 9 }];
  // Backspace inside the label.
  assert.deepEqual(remapEntities('for Naish', 'for Nash', entities), []);
});

test('remapEntities: deleting the whole token removes it', () => {
  const entities = [{ type: 'user', id: USER_ID, label: 'Naish', start: 4, end: 9 }];
  assert.deepEqual(remapEntities('for Naish', 'for ', entities), []);
});

test('remapEntities: an unrelated edit keeps both tokens and moves the later one', () => {
  const text = 'Is the event Mr. Untz locked for Naish';
  const entities = [
    { type: 'event', id: EVENT_ID, label: 'Mr. Untz', start: 13, end: 21 },
    { type: 'user', id: USER_ID, label: 'Naish', start: 33, end: 38 },
  ];
  const nextText = 'Is the event Mr. Untz locked in for Naish';
  const next = remapEntities(text, nextText, entities);

  assert.equal(next.length, 2);
  assert.equal(nextText.slice(next[0].start, next[0].end), 'Mr. Untz');
  assert.equal(nextText.slice(next[1].start, next[1].end), 'Naish');
});

test('remapEntities: a paste that replaces everything clears the metadata', () => {
  const entities = [{ type: 'user', id: USER_ID, label: 'Naish', start: 4, end: 9 }];
  assert.deepEqual(remapEntities('for Naish', 'totally different text', entities), []);
});

test('remapEntities: no text change is a no-op', () => {
  const entities = [{ type: 'user', id: USER_ID, label: 'Naish', start: 4, end: 9 }];
  assert.deepEqual(remapEntities('for Naish', 'for Naish', entities), entities);
});

test('remapEntities: never returns an entity pointing past the new text', () => {
  const entities = [{ type: 'user', id: USER_ID, label: 'Naish', start: 4, end: 9 }];
  for (const e of remapEntities('for Naish', 'f', entities)) {
    assert.ok(e.end <= 1, 'offsets must stay inside the new body');
  }
});

// ---------------------------------------------------------------------------
// removeEntity
// ---------------------------------------------------------------------------

test('removeEntity: takes the token, its text, and no double space', () => {
  const text = 'ping Naish today';
  const entity = { type: 'user', id: USER_ID, label: 'Naish', start: 5, end: 10 };
  const next = removeEntity({ text, entities: [entity], entity });
  assert.equal(next.text, 'ping today');
  assert.deepEqual(next.entities, []);
  assert.equal(next.caret, 5);
});

test('removeEntity: keeps and shifts the tokens around it', () => {
  const text = 'Mr. Untz for Naish';
  const event = { type: 'event', id: EVENT_ID, label: 'Mr. Untz', start: 0, end: 8 };
  const user = { type: 'user', id: USER_ID, label: 'Naish', start: 13, end: 18 };
  const next = removeEntity({ text, entities: [event, user], entity: event });

  assert.equal(next.text, 'for Naish');
  assert.equal(next.entities.length, 1);
  assert.equal(next.text.slice(next.entities[0].start, next.entities[0].end), 'Naish');
});

// ---------------------------------------------------------------------------
// sortEntities / normalizeEntities
// ---------------------------------------------------------------------------

test('sortEntities: orders by start and discards overlaps', () => {
  const out = sortEntities([
    { type: 'user', id: 'b', label: 'B', start: 10, end: 15 },
    { type: 'user', id: 'a', label: 'A', start: 0, end: 5 },
    { type: 'user', id: 'c', label: 'C', start: 12, end: 18 },
  ]);
  assert.deepEqual(out.map((e) => e.id), ['a', 'b']);
});

test('normalizeEntities: keeps a well-formed entity', () => {
  const out = normalizeEntities(
    [{ type: 'user', id: USER_ID, label: 'Naish', start: 4, end: 9 }],
    'for Naish'
  );
  assert.equal(out.length, 1);
});

test('normalizeEntities: discards every malformed shape', () => {
  const body = 'for Naish';
  const bad = [
    null,
    'nope',
    42,
    { type: 'ghost', id: USER_ID, label: 'x', start: 0, end: 3 },
    { type: 'user', label: 'x', start: 0, end: 3 },
    { type: 'user', id: '', label: 'x', start: 0, end: 3 },
    { type: 'user', id: USER_ID, label: 'x', start: 3, end: 3 },
    { type: 'user', id: USER_ID, label: 'x', start: 5, end: 2 },
    { type: 'user', id: USER_ID, label: 'x', start: -1, end: 3 },
    { type: 'user', id: USER_ID, label: 'x', start: 0, end: 9999 },
    { type: 'user', id: USER_ID, label: 'x', start: 1.5, end: 3 },
  ];
  assert.deepEqual(normalizeEntities(bad, body), []);
});

test('normalizeEntities: tolerates a non-array, a JSON string, and junk', () => {
  assert.deepEqual(normalizeEntities(undefined, 'x'), []);
  assert.deepEqual(normalizeEntities({ type: 'user' }, 'x'), []);
  assert.deepEqual(normalizeEntities('{not json', 'x'), []);
  assert.equal(
    normalizeEntities(JSON.stringify([{ type: 'user', id: USER_ID, label: 'Naish', start: 4, end: 9 }]), 'for Naish').length,
    1
  );
});

test('normalizeEntities: a missing label falls back to the body text', () => {
  const out = normalizeEntities([{ type: 'user', id: USER_ID, start: 4, end: 9 }], 'for Naish');
  assert.equal(out[0].label, 'Naish');
});

// ---------------------------------------------------------------------------
// segmentMessage
// ---------------------------------------------------------------------------

test('segmentMessage: splits the example message into readable runs', () => {
  const body = 'Is the event Mr. Untz already locked in on contract for Naish';
  const entities = [
    { type: 'event', id: EVENT_ID, label: 'Mr. Untz', start: 13, end: 21 },
    { type: 'user', id: USER_ID, label: 'Naish', start: 56, end: 61 },
  ];
  const segments = segmentMessage(body, entities);

  assert.deepEqual(segments.map((s) => s.kind), ['text', 'event', 'text', 'user']);
  assert.equal(segments[1].text, 'Mr. Untz');
  assert.equal(segments[3].text, 'Naish');
});

test('segmentMessage: concatenating the segments always rebuilds the body', () => {
  const body = 'Is the event Mr. Untz already locked in on contract for Naish';
  const cases = [
    [],
    [{ type: 'event', id: EVENT_ID, label: 'Mr. Untz', start: 13, end: 21 }],
    // Stale metadata: offsets from a previous edit of the message.
    [{ type: 'user', id: USER_ID, label: 'Naish', start: 900, end: 905 }],
    // Overlapping garbage.
    [
      { type: 'event', id: EVENT_ID, label: 'a', start: 0, end: 10 },
      { type: 'user', id: USER_ID, label: 'b', start: 5, end: 15 },
    ],
    'not even an array',
  ];
  for (const entities of cases) {
    const rebuilt = segmentMessage(body, entities).map((s) => s.text).join('');
    assert.equal(rebuilt, body, 'no metadata state may lose or duplicate text');
  }
});

test('segmentMessage: an empty body yields no segments', () => {
  assert.deepEqual(segmentMessage('', []), []);
  assert.deepEqual(segmentMessage(null, null), []);
});

test('segmentMessage: an entity covering the whole body yields one entity run', () => {
  const segments = segmentMessage('Naish', [
    { type: 'user', id: USER_ID, label: 'Naish', start: 0, end: 5 },
  ]);
  assert.deepEqual(segments.map((s) => s.kind), ['user']);
});

// ---------------------------------------------------------------------------
// flatten / mention checks
// ---------------------------------------------------------------------------

test('flattenEntityIds: dedupes and splits by type', () => {
  const out = flattenEntityIds([
    { type: 'user', id: USER_ID, label: 'Naish', start: 0, end: 5 },
    { type: 'user', id: USER_ID, label: 'Naish', start: 10, end: 15 },
    { type: 'event', id: EVENT_ID, label: 'Mr. Untz', start: 20, end: 28 },
  ]);
  assert.deepEqual(out, { mentioned_user_ids: [USER_ID], linked_event_ids: [EVENT_ID] });
});

test('flattenEntityIds: empty input yields empty arrays', () => {
  assert.deepEqual(flattenEntityIds(null), { mentioned_user_ids: [], linked_event_ids: [] });
});

test('trimBodyWithEntities: leading whitespace shifts every offset', () => {
  const text = '   ping Naish  ';
  const entities = [{ type: 'user', id: USER_ID, label: 'Naish', start: 8, end: 13 }];
  const out = trimBodyWithEntities(text, entities);

  assert.equal(out.body, 'ping Naish');
  assert.equal(out.body.slice(out.entities[0].start, out.entities[0].end), 'Naish');
});

test('trimBodyWithEntities: no leading whitespace leaves offsets untouched', () => {
  const entities = [{ type: 'user', id: USER_ID, label: 'Naish', start: 5, end: 10 }];
  const out = trimBodyWithEntities('ping Naish\n', entities);
  assert.equal(out.body, 'ping Naish');
  assert.deepEqual(out.entities, entities);
});

test('trimBodyWithEntities: a token trimmed away is dropped, not clamped', () => {
  const entities = [{ type: 'user', id: USER_ID, label: 'Naish', start: 0, end: 5 }];
  // A token followed only by whitespace survives; one that would hang off the
  // end after trimming does not.
  assert.equal(trimBodyWithEntities('Naish   ', entities).entities.length, 1);
  assert.deepEqual(trimBodyWithEntities('  Nai', entities).entities, []);
});

test('trimBodyWithEntities: every surviving offset still matches its label text', () => {
  const text = '\n\n  Is the event Mr. Untz locked for Naish  \n';
  const trimmedStart = text.length - text.trimStart().length;
  const entities = [
    { type: 'event', id: EVENT_ID, label: 'Mr. Untz', start: trimmedStart + 13, end: trimmedStart + 21 },
    { type: 'user', id: USER_ID, label: 'Naish', start: trimmedStart + 33, end: trimmedStart + 38 },
  ];
  const out = trimBodyWithEntities(text, entities);

  assert.equal(out.entities.length, 2);
  for (const e of out.entities) {
    assert.equal(out.body.slice(e.start, e.end), e.label);
  }
});

test('messageMentionsUser: reads the flattened array defensively', () => {
  assert.equal(messageMentionsUser({ mentioned_user_ids: [USER_ID] }, USER_ID), true);
  assert.equal(messageMentionsUser({ mentioned_user_ids: [] }, USER_ID), false);
  assert.equal(messageMentionsUser({}, USER_ID), false);
  assert.equal(messageMentionsUser(null, USER_ID), false);
  assert.equal(messageMentionsUser({ mentioned_user_ids: [USER_ID] }, null), false);
});

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

test('normalizeForSearch: folds case, accents and punctuation', () => {
  assert.equal(normalizeForSearch('Mr. Untz'), 'mr untz');
  assert.equal(normalizeForSearch('  JOSÉ   Álvarez '), 'jose alvarez');
  assert.equal(normalizeForSearch(null), '');
});

test('matchRank: orders exact above prefix above word-prefix above substring', () => {
  assert.ok(matchRank('naish kulpath', 'naish kulpath') < matchRank('naish kulpath', 'naish'));
  assert.ok(matchRank('naish kulpath', 'naish') < matchRank('naish kulpath', 'kulpath'));
  assert.ok(matchRank('naish kulpath', 'kulpath') < matchRank('naish kulpath', 'ulpat'));
  assert.equal(matchRank('naish kulpath', 'zzz'), null);
});

test('matchRank: an empty query matches everything', () => {
  assert.notEqual(matchRank('anything', ''), null);
});

test('matchRank: short initials match, long ones do not', () => {
  assert.notEqual(matchRank('naish kulpath', 'nk'), null);
  assert.equal(matchRank('naish kulpath', 'nkx'), null);
});

const TEAM = [
  { user_id: 'u1', full_name: 'Naish Kulpath', email: 'naish@sdgatx.com', role: 'team' },
  { user_id: 'u2', full_name: 'Adam Jarrett', email: 'adam@sdgatx.com', role: 'admin' },
  { user_id: 'u3', full_name: 'Jeyu Bigelow', email: 'jeyu@sdgatx.com', role: 'team' },
  { user_id: 'u4', full_name: 'Alex Rivera', email: 'alex.r@sdgatx.com', role: 'team' },
  { user_id: 'u5', full_name: 'Alex Rivera', email: 'arivera@sdgatx.com', role: 'admin' },
];

test('searchUserCandidates: finds a teammate by name fragment', () => {
  assert.deepEqual(searchUserCandidates(TEAM, 'nai').map((c) => c.user_id), ['u1']);
});

test('searchUserCandidates: finds a teammate by email when the name misses', () => {
  assert.deepEqual(searchUserCandidates(TEAM, 'arivera').map((c) => c.user_id), ['u5']);
});

test('searchUserCandidates: a name match outranks an email match', () => {
  const hit = searchUserCandidates(
    [
      { user_id: 'byEmail', full_name: 'Someone Else', email: 'naish@partner.com' },
      { user_id: 'byName', full_name: 'Naish Kulpath', email: 'nk@sdgatx.com' },
    ],
    'naish'
  );
  assert.equal(hit[0].user_id, 'byName');
});

test('searchUserCandidates: an empty query lists candidates alphabetically', () => {
  const ids = searchUserCandidates(TEAM, '').map((c) => c.full_name);
  assert.deepEqual(ids, [...ids].sort((a, b) => a.localeCompare(b)));
});

test('searchUserCandidates: respects the limit and skips rows without a user_id', () => {
  assert.equal(searchUserCandidates(TEAM, '', 2).length, 2);
  assert.deepEqual(searchUserCandidates([{ full_name: 'Ghost' }], 'gho'), []);
});

test('searchUserCandidates: no match yields an empty list, not everything', () => {
  assert.deepEqual(searchUserCandidates(TEAM, 'zzzzz'), []);
});

const TODAY = '2026-08-31';
const EVENTS = [
  { id: 'e1', title: 'Mr. Untz', event_date: '2026-09-05', status: 'published', visibility: 'public' },
  { id: 'e2', title: 'Mr. Untz', event_date: '2025-03-14', status: 'published', visibility: 'public' },
  { id: 'e3', title: 'Kava Sunday Social', event_date: '2026-09-01', status: 'draft', visibility: 'public' },
  { id: 'e4', title: 'Untz Warehouse Takeover', event_date: '2026-12-31', status: 'published', visibility: 'internal' },
  { id: 'e5', title: 'Staff Meeting', event_date: null, status: 'published', visibility: 'internal' },
];

test('searchEventCandidates: prefers the upcoming event over the past one of the same name', () => {
  assert.deepEqual(
    searchEventCandidates(EVENTS, 'mr untz', { todayIso: TODAY }).map((e) => e.id),
    ['e1', 'e2']
  );
});

test('searchEventCandidates: a title prefix outranks a mid-title substring', () => {
  const ids = searchEventCandidates(EVENTS, 'untz', { todayIso: TODAY }).map((e) => e.id);
  assert.equal(ids[0], 'e4', 'Untz Warehouse Takeover starts with the query');
});

test('searchEventCandidates: matches punctuation-insensitively', () => {
  assert.ok(searchEventCandidates(EVENTS, 'mr. untz', { todayIso: TODAY }).length >= 1);
  assert.ok(searchEventCandidates(EVENTS, 'MR UNTZ', { todayIso: TODAY }).length >= 1);
});

test('searchEventCandidates: unfiltered puts the soonest upcoming event first and dateless last', () => {
  const ids = searchEventCandidates(EVENTS, '', { todayIso: TODAY }).map((e) => e.id);
  assert.equal(ids[0], 'e3', 'tomorrow');
  assert.equal(ids[ids.length - 1], 'e5', 'no date');
  assert.ok(ids.indexOf('e2') > ids.indexOf('e4'), 'past events sort after upcoming ones');
});

test('searchEventCandidates: tolerates a missing today and bad input', () => {
  assert.equal(searchEventCandidates(EVENTS, 'untz').length > 0, true);
  assert.deepEqual(searchEventCandidates(null, 'x'), []);
  assert.deepEqual(searchEventCandidates([{ title: 'no id' }], ''), []);
});

test('daysFromToday: signs upcoming positive and past negative', () => {
  assert.equal(daysFromToday('2026-09-01', TODAY), 1);
  assert.equal(daysFromToday('2026-08-30', TODAY), -1);
  assert.equal(daysFromToday(null, TODAY), null);
  assert.equal(daysFromToday('nonsense', TODAY), null);
});

// ---------------------------------------------------------------------------
// dropdown labels
// ---------------------------------------------------------------------------

test('eventContextLabel: date alone for a published public event', () => {
  assert.equal(eventContextLabel(EVENTS[0]), 'Sep 5, 2026');
});

test('eventContextLabel: adds status and visibility when they are not the default', () => {
  assert.equal(eventContextLabel(EVENTS[2]), 'Sep 1, 2026 · draft');
  assert.equal(eventContextLabel(EVENTS[3]), 'Dec 31, 2026 · internal');
});

test('eventContextLabel: a dateless event still gets a line', () => {
  assert.equal(eventContextLabel(EVENTS[4]), 'No date · internal');
  assert.equal(eventContextLabel(null), '');
});

test('userContextLabel: role, plus email only when asked or when there is no role', () => {
  assert.equal(userContextLabel(TEAM[0]), 'Team');
  assert.equal(userContextLabel(TEAM[1]), 'Admin');
  assert.equal(userContextLabel(TEAM[0], { showEmail: true }), 'Team · naish@sdgatx.com');
  assert.equal(userContextLabel({ email: 'x@y.com' }), 'x@y.com');
  assert.equal(userContextLabel(null), '');
});

test('duplicateDisplayNames: flags only the names that actually collide', () => {
  const dupes = duplicateDisplayNames(TEAM);
  assert.ok(dupes.has('alex rivera'));
  assert.ok(!dupes.has('naish kulpath'));
});

test('memberInitials: first and last initial, with sensible fallbacks', () => {
  assert.equal(memberInitials({ full_name: 'Naish Kulpath' }), 'NK');
  assert.equal(memberInitials({ full_name: 'Adam Michael Jarrett' }), 'AJ');
  assert.equal(memberInitials({ full_name: 'Cher' }), 'CH');
  assert.equal(memberInitials({ email: 'jeyu@sdgatx.com' }), 'JE');
  assert.equal(memberInitials({}), '?');
});

// ---------------------------------------------------------------------------
// resolveEntityLabel — the rename-proofing
// ---------------------------------------------------------------------------

test('resolveEntityLabel: live data wins over the stored label', () => {
  const entity = { type: 'event', id: EVENT_ID, label: 'Mr. Untz', start: 0, end: 8 };
  const out = resolveEntityLabel(entity, {
    eventsById: { [EVENT_ID]: { id: EVENT_ID, title: 'Mr. Untz (Rescheduled)' } },
  });
  assert.equal(out.label, 'Mr. Untz (Rescheduled)');
  assert.equal(out.resolved, true);
});

test('resolveEntityLabel: an unavailable record falls back to the stored label', () => {
  const out = resolveEntityLabel(
    { type: 'event', id: EVENT_ID, label: 'Mr. Untz', start: 0, end: 8 },
    { eventsById: {} }
  );
  assert.equal(out.label, 'Mr. Untz');
  assert.equal(out.resolved, false);
});

test('resolveEntityLabel: a renamed teammate resolves, a removed one falls back', () => {
  const entity = { type: 'user', id: USER_ID, label: 'Naish', start: 0, end: 5 };
  assert.equal(
    resolveEntityLabel(entity, { usersByUserId: { [USER_ID]: { full_name: 'Naish Kulpath' } } }).label,
    'Naish Kulpath'
  );
  assert.equal(resolveEntityLabel(entity, {}).label, 'Naish');
});

test('resolveEntityLabel: falls back to email, then to a safe placeholder', () => {
  const entity = { type: 'user', id: USER_ID, label: '', start: 0, end: 0 };
  assert.equal(
    resolveEntityLabel(entity, { usersByUserId: { [USER_ID]: { email: 'naish@sdgatx.com' } } }).label,
    'naish@sdgatx.com'
  );
  assert.equal(resolveEntityLabel(entity, {}).label, 'Unknown');
  assert.equal(resolveEntityLabel(null, {}).label, 'Unknown');
});
