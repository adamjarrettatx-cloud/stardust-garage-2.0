// Shared light/dark palettes for the owner-only admin income surfaces
// (Financial Calendar + Event Analytics). Kept as a pure, dependency-free
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
