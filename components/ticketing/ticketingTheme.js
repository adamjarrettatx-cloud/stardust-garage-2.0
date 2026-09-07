// Shared style tokens + tiny UI helpers for the ticketing admin panels
// (ProductEditor, DiscountCodesManager). Matches the rest of the bananas
// admin theme (auth-* CSS vars, Plus Jakarta Sans, pill "auth-theme-border-
// button" call-to-actions).
//
// Everything here is inline-style objects and helper components so we don't
// need to touch tailwind config or global CSS. If a token is missing at
// runtime (older themes) the second value in `var(..., fallback)` kicks in.

export const T = {
  fontStack: "'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif",

  // Surfaces
  panelBg: 'var(--auth-panel-bg, rgba(255,255,255,0.02))',
  cardBg: 'var(--auth-card-bg, rgba(255,255,255,0.03))',
  innerBg: 'var(--auth-card-inner-bg, rgba(255,255,255,0.04))',
  border: 'var(--auth-border, #333)',
  borderSoft: 'var(--auth-card-border, rgba(255,255,255,0.08))',
  accent: 'var(--auth-accent, #7cf)',
  accentText: 'var(--auth-accent-text, #001018)',
  strongText: 'var(--auth-text-strong, #fff)',
  text: 'var(--auth-text, #eaeaea)',
  muted: 'var(--auth-muted, rgba(255,255,255,0.55))',
  faint: 'var(--auth-faint, rgba(255,255,255,0.4))',

  // States
  danger: '#f97066',
  success: '#22c55e',
  warning: '#f59e0b',
};

// Section header, e.g. "TICKET PRODUCTS"
export function sectionHeaderStyle() {
  return {
    margin: 0,
    fontSize: 13,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: T.strongText,
    fontFamily: T.fontStack,
    fontWeight: 700,
  };
}

// Description under a section header
export function sectionSubStyle() {
  return { margin: '4px 0 12px 0', fontSize: 12, color: T.muted };
}

// Label above an input (e.g. "Name *")
export function fieldLabelStyle() {
  return {
    display: 'block',
    fontSize: 11,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: T.muted,
    marginBottom: 6,
    fontFamily: T.fontStack,
    fontWeight: 600,
  };
}

// Base themed input (text/number/datetime-local/select/textarea)
export function inputStyle({ width, invalid } = {}) {
  return {
    width: width ?? '100%',
    padding: '9px 11px',
    background: T.innerBg,
    color: T.text,
    border: `1px solid ${invalid ? T.danger : T.border}`,
    borderRadius: 8,
    fontSize: 13,
    fontFamily: T.fontStack,
    outline: 'none',
    // Pull native date/select controls in line with dark surface
    colorScheme: 'dark',
  };
}

// Card panel wrapper (form panels, product cards, etc)
export function cardStyle({ padding } = {}) {
  return {
    border: `1px solid ${T.border}`,
    borderRadius: 12,
    padding: padding ?? 16,
    background: T.cardBg,
  };
}

// Inline pill call-to-action styles (paired with auth-theme-border-button)
export function pillClass(variant = 'default') {
  const base = 'auth-theme-border-button px-4 py-2 rounded-full text-[11px] font-semibold tracking-[0.12em] border';
  if (variant === 'primary') return base + ' shadow-sm';
  return base;
}

// Emphasized "+ NEW ..." button style (solid accent so it reads as a CTA)
export function primaryPillStyle({ disabled } = {}) {
  return {
    background: T.accent,
    color: T.accentText,
    borderColor: T.accent,
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: T.fontStack,
  };
}

// Ghost pill (Cancel, Edit, Delete row actions)
export function ghostPillStyle({ disabled, danger } = {}) {
  return {
    background: 'transparent',
    color: danger ? T.danger : T.text,
    borderColor: danger ? T.danger : T.border,
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: T.fontStack,
  };
}

// Small checkbox-with-label row that inherits theme colors.
export function CheckboxRow({ checked, onChange, label, disabled }) {
  return (
    <label
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 13,
        color: T.text,
        fontFamily: T.fontStack,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <input
        type="checkbox"
        checked={!!checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        style={{ accentColor: T.accent, width: 16, height: 16 }}
      />
      <span>{label}</span>
    </label>
  );
}

// Themed table header cell
export function thStyle({ align = 'left' } = {}) {
  return {
    textAlign: align,
    padding: '10px 12px',
    fontSize: 11,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: T.muted,
    fontFamily: T.fontStack,
    fontWeight: 600,
    borderBottom: `1px solid ${T.border}`,
    background: T.innerBg,
  };
}

export function tdStyle({ align = 'left' } = {}) {
  return {
    textAlign: align,
    padding: '12px',
    fontSize: 13,
    color: T.text,
    fontFamily: T.fontStack,
    borderBottom: `1px solid ${T.borderSoft}`,
    verticalAlign: 'top',
  };
}

export function tableStyle() {
  return {
    width: '100%',
    borderCollapse: 'separate',
    borderSpacing: 0,
    border: `1px solid ${T.border}`,
    borderRadius: 12,
    overflow: 'hidden',
    background: T.cardBg,
  };
}

// Muted status pill
export function statusPill({ tone = 'muted' } = {}) {
  const palette = {
    success: { bg: 'rgba(34,197,94,0.15)', color: '#4ade80', border: 'rgba(34,197,94,0.4)' },
    danger: { bg: 'rgba(249,112,102,0.12)', color: '#f97066', border: 'rgba(249,112,102,0.4)' },
    warning: { bg: 'rgba(245,158,11,0.15)', color: '#fbbf24', border: 'rgba(245,158,11,0.4)' },
    accent: { bg: 'rgba(124,204,255,0.15)', color: T.accent, border: 'rgba(124,204,255,0.4)' },
    muted: { bg: 'rgba(255,255,255,0.06)', color: T.muted, border: T.borderSoft },
  };
  const p = palette[tone] || palette.muted;
  return {
    display: 'inline-block',
    padding: '2px 10px',
    background: p.bg,
    color: p.color,
    border: `1px solid ${p.border}`,
    borderRadius: 999,
    fontSize: 11,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    fontWeight: 600,
    fontFamily: T.fontStack,
  };
}
