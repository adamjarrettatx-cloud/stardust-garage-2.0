// Strict projection at the API boundary. Invalid/incomplete data is never "free".
export function availabilityDays(rows) {
  if (!Array.isArray(rows) || rows.length !== 365) throw new Error('Invalid availability');
  let previous = null;
  return rows.map(row => {
    if (!row || typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)
      || typeof row.available !== 'boolean') throw new Error('Invalid availability');
    const timestamp = Date.parse(`${row.date}T00:00:00Z`);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0,10) !== row.date
      || (previous !== null && timestamp - previous !== 86400000)) throw new Error('Invalid availability');
    previous = timestamp;
    return { date: row.date, available: row.available };
  });
}
