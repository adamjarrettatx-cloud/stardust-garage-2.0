// Pure CSV import mapping for the Progress Tracker. Turns a spreadsheet export
// (the columns the team already keeps: Department/Area, Deliverable, Status)
// into validated task rows ready for insert. No I/O — the admin route reads the
// uploaded file / pasted text and passes the string here.
//
// The importer is intentionally forgiving: it maps free-form status text to our
// enum (never failing on an odd note), resolves department names to canonical
// slugs, and reports per-row errors instead of throwing so an admin sees
// exactly which lines need attention. It does NOT insert the spreadsheet's
// free-form status notes as production status — the original Status text is
// preserved into the task description so nothing is lost while the canonical
// status is the mapped enum value.

import { parseCsv } from './pos-csv.js';
import { DEPARTMENTS, mapImportStatus } from './progress.js';

// Accept a header cell and normalise it for matching (lowercase, strip spaces
// and punctuation) so "Department / Area", "department", "Area" all match.
function normHeader(h) {
  return String(h || '').trim().toLowerCase().replace(/[^a-z]/g, '');
}

// Build a case/spacing-insensitive lookup from department label OR slug to slug.
const DEPT_LOOKUP = (() => {
  const map = {};
  for (const d of DEPARTMENTS) {
    map[normHeader(d.label)] = d.slug;
    map[normHeader(d.slug)] = d.slug;
  }
  // A couple of common spreadsheet aliases.
  map[normHeader('supplies')] = 'supplies_inventory';
  map[normHeader('inventory')] = 'supplies_inventory';
  map[normHeader('membership')] = 'memberships';
  return map;
})();

export function resolveDepartment(raw) {
  return DEPT_LOOKUP[normHeader(raw)] || null;
}

// Map the parsed header row to column indexes. Returns null when the required
// Department + Deliverable columns can't be found.
function mapColumns(headerRow) {
  const idx = { department: -1, deliverable: -1, status: -1 };
  headerRow.forEach((cell, i) => {
    const h = normHeader(cell);
    if (idx.department === -1 && (h === 'department' || h === 'area' || h === 'departmentarea')) {
      idx.department = i;
    } else if (
      idx.deliverable === -1 &&
      (h === 'deliverable' || h === 'task' || h === 'title' || h === 'item')
    ) {
      idx.deliverable = i;
    } else if (idx.status === -1 && (h === 'status' || h === 'notes' || h === 'progress')) {
      idx.status = i;
    }
  });
  if (idx.department === -1 || idx.deliverable === -1) return null;
  return idx;
}

// Parse import CSV text into { rows, errors, columns }.
//   rows:   [{ line, department, title, status, statusNote }]
//   errors: [{ line, message }]
// `line` is 1-based counting the header, so it matches what the admin sees in a
// spreadsheet. Rows with an unknown/empty department are reported as errors and
// excluded from `rows` (a task must belong to a known department).
export function parseImportCsv(text) {
  const table = parseCsv(text);
  if (table.length === 0) {
    return { rows: [], errors: [{ line: 0, message: 'File is empty.' }], columns: null };
  }

  const columns = mapColumns(table[0]);
  if (!columns) {
    return {
      rows: [],
      errors: [{ line: 1, message: 'Header must include Department/Area and Deliverable columns.' }],
      columns: null,
    };
  }

  const rows = [];
  const errors = [];
  for (let i = 1; i < table.length; i++) {
    const line = i + 1;
    const cells = table[i];
    const deptRaw = (cells[columns.department] || '').trim();
    const title = (cells[columns.deliverable] || '').trim();
    const statusNote = columns.status >= 0 ? (cells[columns.status] || '').trim() : '';

    if (!deptRaw && !title && !statusNote) continue; // blank spacer row
    if (!title) {
      errors.push({ line, message: 'Missing deliverable/title.' });
      continue;
    }
    const department = resolveDepartment(deptRaw);
    if (!department) {
      errors.push({ line, message: `Unknown department "${deptRaw}".` });
      continue;
    }
    rows.push({
      line,
      department,
      title,
      status: mapImportStatus(statusNote),
      statusNote,
    });
  }

  return { rows, errors, columns };
}
