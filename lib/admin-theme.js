// Shared light/dark palettes for the owner-only admin surfaces (Financial
// Calendar, Event Analytics, Documents & Templates). Kept as a pure, dependency-free
// module so the token contract is unit-testable and the two client components
// stay in visual lockstep. The Team Calendar convention is the source of truth
// for the panel/cell/hover tokens; the green revenue accent deepens on light so
// dollar figures stay legible on white cards.
//
// These are plain data (no React, no I/O), imported by the client components
// via `@/lib/admin-theme` and by tests via a relative path.

import { ENTRY_STATE } from './financial-calendar.js';

export const FINANCIAL_THEME_KEY = 'sdg-admin-financial-theme';
export const ANALYTICS_THEME_KEY = 'sdg-admin-analytics-theme';

export const FINANCIAL_THEMES = {
  dark: {
    panelBg: null, panelShadow: 'none',
    text: '#f5f5f5', textStrong: '#ffffff', muted: '#8a8a8a', mutedStrong: '#c8c8c8', faint: '#6a6a6a',
    cardBg: '#141414', cardBorder: 'rgba(255,255,255,0.06)',
    cellBg: '#141414', cellBgOutside: '#0f0f0f', gridLine: 'rgba(255,255,255,0.04)',
    border: 'rgba(255,255,255,0.12)', borderSoft: 'rgba(255,255,255,0.08)', divider: 'rgba(255,255,255,0.05)',
    selectedBg: 'rgba(255,255,255,0.08)', selectedOutline: '1px solid rgba(255,255,255,0.2)',
    todayBg: '#ffffff', todayText: '#0a0a0a', dayNumOutside: '#333333', hoverBg: 'rgba(255,255,255,0.1)',
    rev: '#4ade80', revStrong: '#4ade80', revCardBg: '#0f1a12', revCardBorder: 'rgba(74,222,128,0.22)',
    revChipBg: 'rgba(74,222,128,0.12)', revChipBorder: 'rgba(74,222,128,0.3)',
    revDetailBg: '#0f1a12', revDetailBorder: 'rgba(74,222,128,0.22)',
    revSubBg: 'rgba(74,222,128,0.06)', revSubBorder: 'rgba(74,222,128,0.16)',
    neutralChipBg: 'rgba(255,255,255,0.05)', neutralChipBorder: 'rgba(255,255,255,0.08)',
    neutralDetailBg: '#101010',
    warn: '#ffb84d', warnBadgeBg: 'rgba(255,184,77,0.14)',
    err: '#f87171', errBg: 'rgba(248,113,113,0.1)',
    addBtnBg: '#4ade80', addBtnText: '#0a0a0a',
  },
  light: {
    panelBg: '#faf9f6', panelShadow: '0 24px 64px rgba(0,0,0,0.35)',
    text: '#1a1a1d', textStrong: '#000000', muted: '#5c5c63', mutedStrong: '#3a3a40', faint: '#7a7a80',
    cardBg: '#ffffff', cardBorder: 'rgba(0,0,0,0.1)',
    cellBg: '#ffffff', cellBgOutside: '#efece6', gridLine: 'rgba(0,0,0,0.08)',
    border: 'rgba(0,0,0,0.18)', borderSoft: 'rgba(0,0,0,0.12)', divider: 'rgba(0,0,0,0.08)',
    selectedBg: 'rgba(0,0,0,0.06)', selectedOutline: '1px solid rgba(0,0,0,0.2)',
    todayBg: '#1a1a1d', todayText: '#ffffff', dayNumOutside: '#c7c4bc', hoverBg: 'rgba(0,0,0,0.06)',
    rev: '#047857', revStrong: '#065f46', revCardBg: '#ecfbf3', revCardBorder: 'rgba(4,120,87,0.3)',
    revChipBg: 'rgba(4,120,87,0.12)', revChipBorder: 'rgba(4,120,87,0.35)',
    revDetailBg: '#ecfbf3', revDetailBorder: 'rgba(4,120,87,0.28)',
    revSubBg: 'rgba(4,120,87,0.08)', revSubBorder: 'rgba(4,120,87,0.22)',
    neutralChipBg: 'rgba(0,0,0,0.04)', neutralChipBorder: 'rgba(0,0,0,0.1)',
    neutralDetailBg: '#f4f2ec',
    warn: '#7c3d0a', warnBadgeBg: 'rgba(245,158,11,0.18)',
    err: '#b91c1c', errBg: 'rgba(220,38,38,0.08)',
    addBtnBg: '#047857', addBtnText: '#ffffff',
  },
};

export const ANALYTICS_THEMES = {
  dark: {
    panelBg: null, panelShadow: 'none',
    text: '#f5f5f5', textStrong: '#ffffff', muted: '#8a8a8a', mutedStrong: '#c8c8c8', faint: '#6a6a6a',
    cardBg: '#141414', cardBorder: 'rgba(255,255,255,0.06)',
    tableBorder: 'rgba(255,255,255,0.06)', rowBorder: 'rgba(255,255,255,0.04)',
    rev: '#4ade80', revCardBg: '#0f1a12', revCardBorder: 'rgba(74,222,128,0.22)',
    warn: '#ffb84d', warnCardBg: '#16140d', warnCardBorder: 'rgba(255,184,77,0.25)',
    grossText: '#e8e8e8', codeText: '#ffffff',
  },
  light: {
    panelBg: '#faf9f6', panelShadow: '0 24px 64px rgba(0,0,0,0.35)',
    text: '#1a1a1d', textStrong: '#000000', muted: '#5c5c63', mutedStrong: '#3a3a40', faint: '#7a7a80',
    cardBg: '#ffffff', cardBorder: 'rgba(0,0,0,0.1)',
    tableBorder: 'rgba(0,0,0,0.1)', rowBorder: 'rgba(0,0,0,0.07)',
    rev: '#047857', revCardBg: '#ecfbf3', revCardBorder: 'rgba(4,120,87,0.3)',
    warn: '#7c3d0a', warnCardBg: '#fbf3e3', warnCardBorder: 'rgba(180,105,10,0.35)',
    grossText: '#1a1a1d', codeText: '#1a1a1d',
  },
};

// Financial Cash Flow dashboard. Same flat shape as ANALYTICS_THEMES, which it
// borrows its card/table tokens from wholesale so the two owner-only financial
// surfaces read as one family. It adds the tokens the ledger needs and
// Analytics doesn't: an outflow hue, form controls for the SpotOn mapping
// dialog, and a modal overlay.
export const CASHFLOW_THEMES = {
  dark: {
    text: '#f5f5f5', textStrong: '#ffffff', muted: '#8a8a8a', mutedStrong: '#c8c8c8', faint: '#6a6a6a',
    cardBg: '#141414', cardBorder: 'rgba(255,255,255,0.06)',
    tableBorder: 'rgba(255,255,255,0.06)', rowBorder: 'rgba(255,255,255,0.04)',
    rev: '#4ade80', revCardBg: '#0f1a12', revCardBorder: 'rgba(74,222,128,0.22)',
    warn: '#ffb84d', warnCardBg: '#16140d', warnCardBorder: 'rgba(255,184,77,0.25)',
    err: '#f87171', errBg: 'rgba(248,113,113,0.1)', errBorder: 'rgba(248,113,113,0.3)',
    inputBg: '#0d0d0d', inputBorder: 'rgba(255,255,255,0.1)', inputText: '#f5f5f5',
    ghostBorder: 'rgba(255,255,255,0.15)', ghostText: '#f5f5f5',
    btnBg: '#4ade80', btnText: '#0a0a0a',
    overlay: 'rgba(0,0,0,0.7)',
  },
  light: {
    text: '#1a1a1d', textStrong: '#000000', muted: '#5c5c63', mutedStrong: '#3a3a40', faint: '#7a7a80',
    cardBg: '#ffffff', cardBorder: 'rgba(0,0,0,0.1)',
    tableBorder: 'rgba(0,0,0,0.1)', rowBorder: 'rgba(0,0,0,0.07)',
    rev: '#047857', revCardBg: '#ecfbf3', revCardBorder: 'rgba(4,120,87,0.3)',
    warn: '#7c3d0a', warnCardBg: '#fbf3e3', warnCardBorder: 'rgba(180,105,10,0.35)',
    err: '#b91c1c', errBg: 'rgba(220,38,38,0.08)', errBorder: 'rgba(220,38,38,0.3)',
    inputBg: '#ffffff', inputBorder: 'rgba(0,0,0,0.15)', inputText: '#1a1a1d',
    ghostBorder: 'rgba(0,0,0,0.15)', ghostText: '#1a1a1d',
    btnBg: '#047857', btnText: '#ffffff',
    overlay: 'rgba(20,18,14,0.45)',
  },
};

// Documents & Templates admin surfaces. Same flat shape as ANALYTICS_THEMES.
// Dark values are byte-identical to the hexes these pages hardcoded before the
// migration, so dark mode is unchanged; the light half mirrors AUTH_THEMES's
// contrast choices for the hues they share. The status hues (contract state
// badges, category chips) deepen on light so a saturated pastel never lands as
// pale-on-pale.
export const DOCUMENTS_THEMES = {
  dark: {
    text: '#f5f5f5', textStrong: '#ffffff',
    muted: '#8a8a8a', mutedStrong: '#c8c8c8', subtle: '#a8a8a8', faint: '#6a6a6a', hint: '#666666',
    cardBg: '#141414', cardBorder: 'rgba(255,255,255,0.06)', cardBorderStrong: 'rgba(255,255,255,0.10)',
    rowBorder: 'rgba(255,255,255,0.04)', chipBg: 'rgba(255,255,255,0.05)',
    tabBorder: 'rgba(255,255,255,0.08)', overlay: 'rgba(0,0,0,0.7)',
    inputBg: '#0d0d0d', inputBorder: 'rgba(255,255,255,0.08)', inputText: '#ffffff',
    ghostBorder: 'rgba(255,255,255,0.10)', ghostText: '#ffffff',
    solidBg: '#ffffff', solidText: '#000000',
    neutralBg: 'rgba(255,255,255,0.04)', neutralBorder: 'rgba(255,255,255,0.10)',
    danger: '#f87171', dangerText: '#fca5a5', dangerBg: 'rgba(239,68,68,0.1)',
    dangerBorder: 'rgba(239,68,68,0.3)', dangerBorderSoft: 'rgba(239,68,68,0.25)',
    success: '#4ade80', successText: '#86efac', successBg: 'rgba(74,222,128,0.1)',
    successBorder: 'rgba(74,222,128,0.3)', successChipBg: 'rgba(74,222,128,0.12)',
    warn: '#fbbf24', warnBg: 'rgba(251,191,36,0.10)', warnBorder: 'rgba(251,191,36,0.3)',
    accent: '#ffb84d', accentBg: 'rgba(255,184,77,0.12)', accentBorder: 'rgba(255,184,77,0.3)',
    info: '#60a5fa', infoBg: 'rgba(96,165,250,0.10)', infoBorder: 'rgba(96,165,250,0.3)',
    violet: '#a78bfa', violetBg: 'rgba(167,139,250,0.10)', violetBorder: 'rgba(167,139,250,0.3)',
    pink: '#f472b6', pinkBg: 'rgba(244,114,182,0.10)', pinkBorder: 'rgba(244,114,182,0.3)',
    expired: '#f59e0b', voided: '#6b7280',
    // Field-editor label chips sit on a saturated role color from
    // lib/contract-fields, which is theme-independent — so is this ink.
    fieldTagText: '#0d0d0d',
  },
  light: {
    text: '#1a1a1d', textStrong: '#000000',
    muted: '#5c5c63', mutedStrong: '#3a3a40', subtle: '#4a4a50', faint: '#7a7a80', hint: '#7a7a80',
    cardBg: '#ffffff', cardBorder: 'rgba(0,0,0,0.08)', cardBorderStrong: 'rgba(0,0,0,0.14)',
    rowBorder: 'rgba(0,0,0,0.07)', chipBg: 'rgba(0,0,0,0.05)',
    tabBorder: 'rgba(0,0,0,0.12)', overlay: 'rgba(20,18,14,0.45)',
    inputBg: '#ffffff', inputBorder: 'rgba(0,0,0,0.15)', inputText: '#1a1a1d',
    ghostBorder: 'rgba(0,0,0,0.15)', ghostText: '#1a1a1d',
    solidBg: '#1a1a1d', solidText: '#ffffff',
    neutralBg: 'rgba(0,0,0,0.04)', neutralBorder: 'rgba(0,0,0,0.14)',
    danger: '#b91c1c', dangerText: '#b91c1c', dangerBg: 'rgba(220,38,38,0.08)',
    dangerBorder: 'rgba(220,38,38,0.3)', dangerBorderSoft: 'rgba(220,38,38,0.25)',
    success: '#047857', successText: '#047857', successBg: 'rgba(4,120,87,0.1)',
    successBorder: 'rgba(4,120,87,0.3)', successChipBg: 'rgba(4,120,87,0.14)',
    warn: '#8a5109', warnBg: 'rgba(245,158,11,0.16)', warnBorder: 'rgba(180,120,10,0.35)',
    accent: '#8a5109', accentBg: 'rgba(255,184,77,0.18)', accentBorder: 'rgba(184,120,20,0.35)',
    info: '#1d4ed8', infoBg: 'rgba(29,78,216,0.10)', infoBorder: 'rgba(29,78,216,0.3)',
    violet: '#6d28d9', violetBg: 'rgba(109,40,217,0.10)', violetBorder: 'rgba(109,40,217,0.3)',
    pink: '#be185d', pinkBg: 'rgba(190,24,93,0.10)', pinkBorder: 'rgba(190,24,93,0.3)',
    expired: '#b45309', voided: '#4b5563',
    fieldTagText: '#0d0d0d',
  },
};

// Per-state tone so calendar state chips/notes resolve to theme-aware colors
// (muted grey / amber warning / red error) instead of hard-coded hexes.
export const STATE_TONE = {
  [ENTRY_STATE.PENDING]: 'muted',
  [ENTRY_STATE.UNLINKED]: 'warn',
  [ENTRY_STATE.NOT_CONFIGURED]: 'warn',
  [ENTRY_STATE.ERROR]: 'err',
  [ENTRY_STATE.ZERO]: 'muted',
};

// Resolve a per-entry ENTRY_STATE to a text color from a Financial Calendar
// palette `t` (one of FINANCIAL_THEMES.dark / .light). Unknown states fall back
// to the muted tone.
export function stateColor(state, t) {
  const tone = STATE_TONE[state];
  return tone === 'warn' ? t.warn : tone === 'err' ? t.err : t.muted;
}
