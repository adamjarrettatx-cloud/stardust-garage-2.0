import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCsv,
  moneyToCents,
  parsePosTimestamp,
  mapPosRows,
} from '../lib/pos-csv.js';

test('parseCsv handles quoted fields with commas and escaped quotes', () => {
  const text = 'a,b,c\n"x,y",z,"he said ""hi"""\n1,2,3';
  const rows = parseCsv(text);
  assert.deepEqual(rows[0], ['a', 'b', 'c']);
  assert.deepEqual(rows[1], ['x,y', 'z', 'he said "hi"']);
  assert.deepEqual(rows[2], ['1', '2', '3']);
});

test('parseCsv handles CRLF and trailing row without newline', () => {
  const rows = parseCsv('h1,h2\r\n1,2\r\n3,4');
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[2], ['3', '4']);
});

test('moneyToCents parses currency and negatives', () => {
  assert.equal(moneyToCents('$1,234.56'), 123456);
  assert.equal(moneyToCents('12'), 1200);
  assert.equal(moneyToCents('(12.00)'), -1200);
  assert.equal(moneyToCents('-5.50'), -550);
  assert.equal(moneyToCents(''), 0);
  assert.equal(moneyToCents(null), 0);
});

test('parsePosTimestamp parses ISO and US date formats to UTC', () => {
  assert.equal(parsePosTimestamp('2026-06-01T20:00:00Z'), '2026-06-01T20:00:00.000Z');
  assert.equal(parsePosTimestamp('6/1/2026 8:00:00 PM'), '2026-06-01T20:00:00.000Z');
  assert.equal(parsePosTimestamp('6/1/2026 12:00 AM'), '2026-06-01T00:00:00.000Z');
  assert.equal(parsePosTimestamp(''), null);
  assert.equal(parsePosTimestamp('garbage'), null);
});

test('mapPosRows maps by header name and derives net', () => {
  const text = [
    'Timestamp,Gross Sales,Tax,Fees,Description',
    '2026-06-01T20:00:00Z,$100.00,$8.25,$3.00,Beer',
    '2026-06-01T21:00:00Z,$50.00,$4.13,$1.50,Wine',
  ].join('\n');
  const { rows, skipped } = mapPosRows(parseCsv(text));
  assert.equal(skipped, 0);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].grossCents, 10000);
  assert.equal(rows[0].taxCents, 825);
  assert.equal(rows[0].ccFeeCents, 300);
  // net derived = 10000 - 825 - 300
  assert.equal(rows[0].netCents, 8875);
  assert.equal(rows[0].occurredAt, '2026-06-01T20:00:00.000Z');
  assert.equal(rows[0].description, 'Beer');
});

test('mapPosRows uses explicit Net column when present', () => {
  const text = 'date,total,net\n2026-06-01T20:00:00Z,100,90';
  const { rows } = mapPosRows(parseCsv(text));
  assert.equal(rows[0].grossCents, 10000);
  assert.equal(rows[0].netCents, 9000);
});

test('mapPosRows honors a custom column mapping', () => {
  const text = 'when,amt\n2026-06-01T20:00:00Z,42';
  const { rows } = mapPosRows(parseCsv(text), { timestamp: 'when', gross: 'amt' });
  assert.equal(rows[0].grossCents, 4200);
  assert.equal(rows[0].occurredAt, '2026-06-01T20:00:00.000Z');
});

test('mapPosRows skips blank rows', () => {
  const text = 'date,total\n2026-06-01T20:00:00Z,10\n,\n';
  const { rows, skipped } = mapPosRows(parseCsv(text));
  assert.equal(rows.length, 1);
  assert.equal(skipped, 1);
});

test('mapPosRows returns empty for empty input', () => {
  assert.deepEqual(mapPosRows([]), { rows: [], headers: [], skipped: 0 });
});
