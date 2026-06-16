// Pure CSV parsing for imported post-event POS exports. No I/O, no deps — the
// admin route reads the uploaded file and passes the text here. The parser is
// deliberately small (RFC-4180-ish: quoted fields, escaped quotes, CRLF/CR/LF)
// because POS exports are simple comma-separated dumps.
//
// Money is normalized to integer cents. Timestamps are parsed to UTC ISO
// strings; rows whose time can't be parsed keep occurredAt: null and will be
// treated as out-of-window by lib/event-financials.isRowInWindow.

// Split CSV text into an array of string-cell rows. Handles quoted fields with
// embedded commas/newlines and "" escapes.
export function parseCsv(text) {
  if (typeof text !== 'string' || text === '') return [];
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') {
      if (text[i + 1] === '\n') i++;
      row.push(field); field = ''; rows.push(row); row = [];
      continue;
    }
    if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; continue; }
    field += c;
  }
  // Flush the trailing field/row (file without a trailing newline).
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  // Drop fully-empty trailing rows.
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

// Parse a money cell like "$1,234.56", "(12.00)" (negative), "12" -> cents.
export function moneyToCents(value) {
  if (value == null) return 0;
  let s = String(value).trim();
  if (!s) return 0;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  s = s.replace(/[$,\s]/g, '');
  if (s.startsWith('-')) { negative = true; s = s.slice(1); }
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  const cents = Math.round(n * 100);
  return negative ? -cents : cents;
}

// Parse a POS timestamp cell to a UTC ISO string, or null. Accepts ISO strings
// and common "M/D/YYYY H:MM[:SS] [AM|PM]" exports. A bare time with no date is
// not resolvable on its own and returns null.
export function parsePosTimestamp(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  // Native parse handles ISO-8601 and many locale formats.
  const direct = Date.parse(s);
  if (!Number.isNaN(direct)) return new Date(direct).toISOString();
  // "M/D/YYYY h:mm:ss AM/PM"
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?$/i.exec(s);
  if (m) {
    let [, mo, d, y, h, mi, sec, ap] = m;
    let year = Number(y);
    if (year < 100) year += 2000;
    let hour = h ? Number(h) : 0;
    if (ap) {
      const isPm = ap.toLowerCase() === 'pm';
      if (isPm && hour < 12) hour += 12;
      if (!isPm && hour === 12) hour = 0;
    }
    const dt = new Date(Date.UTC(year, Number(mo) - 1, Number(d), hour, mi ? Number(mi) : 0, sec ? Number(sec) : 0));
    if (!Number.isNaN(dt.getTime())) return dt.toISOString();
  }
  return null;
}

// Build a header-index lookup from the first CSV row. Case-insensitive,
// trimmed. Returns { header: index }.
function headerIndex(headerRow) {
  const idx = {};
  headerRow.forEach((h, i) => {
    const key = String(h || '').trim().toLowerCase();
    if (key && !(key in idx)) idx[key] = i;
  });
  return idx;
}

// Resolve a configured column name (or array of fallbacks) to an index.
function resolveColumn(idx, names) {
  const list = Array.isArray(names) ? names : [names];
  for (const n of list) {
    const key = String(n || '').trim().toLowerCase();
    if (key in idx) return idx[key];
  }
  return -1;
}

// Map parsed CSV rows into normalized POS row objects using a column mapping.
//   mapping = { timestamp, gross, tax, ccFee, net, description }
// Each value is a header name or array of candidate header names. Missing
// money columns default to 0; missing net is derived as gross - tax - ccFee.
// Returns { rows: [...], headers: [...], skipped: n }.
export function mapPosRows(parsed, mapping = {}) {
  if (!parsed.length) return { rows: [], headers: [], skipped: 0 };
  const headers = parsed[0].map((h) => String(h || '').trim());
  const idx = headerIndex(parsed[0]);

  const cTime = resolveColumn(idx, mapping.timestamp ?? ['timestamp', 'date', 'datetime', 'time', 'created at', 'transaction date']);
  const cGross = resolveColumn(idx, mapping.gross ?? ['gross', 'gross sales', 'total', 'amount', 'gross amount']);
  const cTax = resolveColumn(idx, mapping.tax ?? ['tax', 'sales tax', 'tax amount']);
  const cCc = resolveColumn(idx, mapping.ccFee ?? ['fees', 'fee', 'card fee', 'processing fee', 'cc fee']);
  const cNet = resolveColumn(idx, mapping.net ?? ['net', 'net sales', 'net total', 'net amount']);
  const cDesc = resolveColumn(idx, mapping.description ?? ['description', 'item', 'name', 'memo']);

  const rows = [];
  let skipped = 0;
  for (let r = 1; r < parsed.length; r++) {
    const cells = parsed[r];
    if (!cells || cells.every((v) => String(v ?? '').trim() === '')) { skipped++; continue; }
    const grossCents = cGross >= 0 ? moneyToCents(cells[cGross]) : 0;
    const taxCents = cTax >= 0 ? moneyToCents(cells[cTax]) : 0;
    const ccFeeCents = cCc >= 0 ? moneyToCents(cells[cCc]) : 0;
    const netCents = cNet >= 0 ? moneyToCents(cells[cNet]) : (grossCents - taxCents - ccFeeCents);
    rows.push({
      occurredAt: cTime >= 0 ? parsePosTimestamp(cells[cTime]) : null,
      grossCents,
      taxCents,
      ccFeeCents,
      netCents,
      description: cDesc >= 0 ? String(cells[cDesc] ?? '').trim().slice(0, 200) : null,
      raw: headers.reduce((o, h, i) => { o[h] = cells[i] ?? null; return o; }, {}),
    });
  }
  return { rows, headers, skipped };
}
