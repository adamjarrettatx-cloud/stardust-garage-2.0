// Deterministic, dependency-free extraction of common financial terms from
// contract text. NO external AI APIs — pure regex heuristics so contract
// contents never leave the server. Results are always presented to an admin
// for review/override before they feed a financial calculation (the
// document_contracts.financial_terms_source column records provenance).
//
// This is intentionally a pragmatic first slice: it recognizes the handful of
// phrasings the user called out — "50% of net profit", "50/50 split",
// "$500 flat fee", "sales tax" — and leaves everything else for manual entry.

// Parse a percentage like "50%", "50 %", "fifty percent" (digits only for now)
// near a "net profit" / "split" cue and return Stardust's share 0..100, or null.
//
// Heuristics, in priority order:
//   1. "X% of net profit to Stardust" / "Stardust ... X%"  -> X
//   2. "X/Y split"  (e.g. "50/50")                          -> X
//   3. "X% ... split" / "split ... X%"                      -> X
export function extractSplitPercent(text) {
  if (!text || typeof text !== 'string') return null;
  const t = text.toLowerCase();

  // "50/50 split" style. Take the first number as Stardust's share.
  const ratio = /(\d{1,3})\s*\/\s*(\d{1,3})\s*(?:split|share)?/.exec(t);
  if (ratio) {
    const a = Number(ratio[1]);
    const b = Number(ratio[2]);
    if (a + b === 100 && a >= 0 && a <= 100) return a;
  }

  // Percent tied to net profit / split / share.
  const pctNearCue = /(\d{1,3}(?:\.\d+)?)\s*%[^.\n]{0,40}?(?:net profit|net|profit|split|share|ticket sales)/.exec(t)
    || /(?:net profit|net|profit|split|share|ticket sales)[^.\n]{0,40}?(\d{1,3}(?:\.\d+)?)\s*%/.exec(t);
  if (pctNearCue) {
    const p = Number(pctNearCue[1]);
    if (Number.isFinite(p) && p >= 0 && p <= 100) return p;
  }
  return null;
}

// Extract a flat fee in cents from phrasings like "$500 flat fee",
// "flat fee of $1,250.00", "guarantee of $500". Returns cents or null.
export function extractFlatFeeCents(text) {
  if (!text || typeof text !== 'string') return null;
  const t = text.toLowerCase();
  const re = /(?:flat fee|guarantee|flat rate|fixed fee)[^$\n]{0,20}?\$\s*([\d,]+(?:\.\d{1,2})?)|\$\s*([\d,]+(?:\.\d{1,2})?)\s*(?:flat fee|guarantee|flat rate|fixed fee)/;
  const m = re.exec(t);
  if (!m) return null;
  const raw = (m[1] || m[2] || '').replace(/,/g, '');
  const dollars = Number(raw);
  if (!Number.isFinite(dollars)) return null;
  return Math.round(dollars * 100);
}

// Detect a sales-tax mention and an optional explicit rate. Returns
//   { mentioned: boolean, bps: number|null }
// bps is basis points (825 = 8.25%) when an explicit rate is present.
export function extractSalesTax(text) {
  if (!text || typeof text !== 'string') return { mentioned: false, bps: null };
  const t = text.toLowerCase();
  const mentioned = /sales tax/.test(t);
  if (!mentioned) return { mentioned: false, bps: null };
  const rate = /sales tax[^%\n]{0,20}?(\d{1,2}(?:\.\d{1,3})?)\s*%/.exec(t)
    || /(\d{1,2}(?:\.\d{1,3})?)\s*%[^.\n]{0,15}?sales tax/.exec(t);
  if (rate) {
    const pct = Number(rate[1]);
    if (Number.isFinite(pct)) return { mentioned: true, bps: Math.round(pct * 100) };
  }
  return { mentioned: true, bps: null };
}

// Who keeps the revenue share, inferred from naming. Defaults to 'split' when a
// percentage was found, else 'stardust'. Very light heuristic.
function inferRecipient(text, hasSplit) {
  if (!hasSplit) return 'stardust';
  return 'split';
}

// Run all extractors over contract text and return a structured terms object
// plus a confidence-ish summary of what was found. The shape mirrors the
// document_contracts financial columns so a route can persist it directly.
//
// Returns:
//   {
//     stardustSplitPercent: number|null,
//     flatFeeCents: number|null,
//     salesTaxMentioned: boolean,
//     salesTaxBps: number|null,
//     revenueShareRecipient: 'stardust'|'counterparty'|'split',
//     matched: string[],          // which terms were detected
//     raw: { ... per-extractor outputs ... }
//   }
export function extractContractFinancialTerms(text) {
  const split = extractSplitPercent(text);
  const flatFeeCents = extractFlatFeeCents(text);
  const salesTax = extractSalesTax(text);
  const matched = [];
  if (split != null) matched.push('split_percent');
  if (flatFeeCents != null) matched.push('flat_fee');
  if (salesTax.mentioned) matched.push('sales_tax');

  return {
    stardustSplitPercent: split,
    flatFeeCents,
    salesTaxMentioned: salesTax.mentioned,
    salesTaxBps: salesTax.bps,
    revenueShareRecipient: inferRecipient(text, split != null),
    matched,
    raw: { split, flatFeeCents, salesTax },
  };
}

// Validate + normalize an admin's manual override of the financial terms into a
// patch for document_contracts. Returns { ok, patch } | { ok: false, error }.
// Mirrors the column constraints in the migration so bad input is rejected
// before it reaches the DB.
export function buildFinancialTermsPatch(body = {}) {
  const patch = {};

  if ('stardust_split_percent' in body) {
    const v = body.stardust_split_percent;
    if (v === null || v === '') {
      patch.stardust_split_percent = null;
    } else {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        return { ok: false, error: 'stardust_split_percent must be 0..100' };
      }
      patch.stardust_split_percent = n;
    }
  }

  if ('flat_fee_cents' in body) {
    const v = body.flat_fee_cents;
    if (v === null || v === '') {
      patch.flat_fee_cents = null;
    } else {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) {
        return { ok: false, error: 'flat_fee_cents must be a non-negative integer' };
      }
      patch.flat_fee_cents = n;
    }
  }

  if ('revenue_share_recipient' in body) {
    const v = String(body.revenue_share_recipient || '');
    if (!['stardust', 'counterparty', 'split'].includes(v)) {
      return { ok: false, error: 'invalid revenue_share_recipient' };
    }
    patch.revenue_share_recipient = v;
  }

  if ('financial_terms' in body) {
    if (typeof body.financial_terms !== 'object' || body.financial_terms === null || Array.isArray(body.financial_terms)) {
      return { ok: false, error: 'financial_terms must be an object' };
    }
    patch.financial_terms = body.financial_terms;
  }

  return { ok: true, patch };
}
