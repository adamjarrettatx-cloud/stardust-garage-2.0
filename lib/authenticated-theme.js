export const AUTH_THEME_STORAGE_KEYS = {
  admin: 'sdg-auth-admin-theme',
  team: 'sdg-auth-team-theme',
};

export const AUTH_THEMES = {
  dark: {
    rootBg: 'transparent',
    panelBg: null,
    panelShadow: 'none',
    text: '#f5f5f5',
    textStrong: '#ffffff',
    muted: '#8a8a8a',
    mutedStrong: '#c8c8c8',
    faint: '#6a6a6a',
    cardBg: '#141414',
    cardBgAlt: '#101010',
    cardBorder: 'rgba(255,255,255,0.06)',
    cardBorderStrong: 'rgba(255,255,255,0.12)',
    tableBorder: 'rgba(255,255,255,0.06)',
    rowBorder: 'rgba(255,255,255,0.05)',
    inputBg: '#0d0d0d',
    inputBorder: 'rgba(255,255,255,0.1)',
    inputText: '#f5f5f5',
    ghostBg: 'rgba(255,255,255,0.06)',
    ghostBorder: 'rgba(255,255,255,0.15)',
    ghostText: '#f5f5f5',
    hoverBg: 'rgba(255,255,255,0.05)',
    hoverBgStrong: 'rgba(255,255,255,0.1)',
    accent: '#ffb84d',
    accentStrong: '#ffb84d',
    accentText: '#0a0a0a',
    strongSurfaceText: '#0a0a0a',
    success: '#4ade80',
    successStrong: '#4ade80',
    successBg: 'rgba(74,222,128,0.12)',
    successBorder: 'rgba(74,222,128,0.3)',
    danger: '#f87171',
    dangerBg: 'rgba(239,68,68,0.12)',
    dangerBorder: 'rgba(239,68,68,0.3)',
    warn: '#ffb84d',
    warnStrong: '#ffd599',
    warnBg: 'rgba(255,184,77,0.12)',
    warnBorder: 'rgba(255,184,77,0.3)',
    overlay: 'rgba(0,0,0,0.7)',
  },
  light: {
    rootBg: '#f2efe8',
    panelBg: '#faf9f6',
    panelShadow: '0 24px 64px rgba(0,0,0,0.18)',
    text: '#1a1a1d',
    textStrong: '#000000',
    muted: '#5c5c63',
    mutedStrong: '#3a3a40',
    faint: '#7a7a80',
    cardBg: '#ffffff',
    cardBgAlt: '#f4f1eb',
    cardBorder: 'rgba(0,0,0,0.08)',
    cardBorderStrong: 'rgba(0,0,0,0.14)',
    tableBorder: 'rgba(0,0,0,0.1)',
    rowBorder: 'rgba(0,0,0,0.07)',
    inputBg: '#ffffff',
    inputBorder: 'rgba(0,0,0,0.15)',
    inputText: '#1a1a1d',
    ghostBg: 'rgba(0,0,0,0.03)',
    ghostBorder: 'rgba(0,0,0,0.15)',
    ghostText: '#1a1a1d',
    hoverBg: 'rgba(0,0,0,0.04)',
    hoverBgStrong: 'rgba(0,0,0,0.06)',
    accent: '#ffb84d',
    accentStrong: '#8a5109',
    accentText: '#0a0a0a',
    strongSurfaceText: '#ffffff',
    success: '#047857',
    successStrong: '#065f46',
    successBg: 'rgba(4,120,87,0.12)',
    successBorder: 'rgba(4,120,87,0.3)',
    danger: '#b91c1c',
    dangerBg: 'rgba(220,38,38,0.08)',
    dangerBorder: 'rgba(220,38,38,0.3)',
    warn: '#8a5109',
    warnStrong: '#7c3d0a',
    warnBg: 'rgba(255,184,77,0.18)',
    warnBorder: 'rgba(184,120,20,0.35)',
    overlay: 'rgba(20,18,14,0.45)',
  },
};

export function isAuthTheme(value) {
  return value === 'dark' || value === 'light';
}

export function resolveAuthTheme(value) {
  return isAuthTheme(value) ? value : 'dark';
}

export function authThemeVars(themeName) {
  const t = AUTH_THEMES[resolveAuthTheme(themeName)];
  return {
    '--auth-root-bg': t.rootBg,
    '--auth-panel-bg': t.panelBg || 'transparent',
    '--auth-panel-shadow': t.panelShadow,
    '--auth-text': t.text,
    '--auth-text-strong': t.textStrong,
    '--auth-muted': t.muted,
    '--auth-muted-strong': t.mutedStrong,
    '--auth-faint': t.faint,
    '--auth-card-bg': t.cardBg,
    '--auth-card-bg-alt': t.cardBgAlt,
    '--auth-card-border': t.cardBorder,
    '--auth-card-border-strong': t.cardBorderStrong,
    '--auth-table-border': t.tableBorder,
    '--auth-row-border': t.rowBorder,
    '--auth-input-bg': t.inputBg,
    '--auth-input-border': t.inputBorder,
    '--auth-input-text': t.inputText,
    '--auth-ghost-bg': t.ghostBg,
    '--auth-ghost-border': t.ghostBorder,
    '--auth-ghost-text': t.ghostText,
    '--auth-hover-bg': t.hoverBg,
    '--auth-hover-bg-strong': t.hoverBgStrong,
    '--auth-accent': t.accent,
    '--auth-accent-strong': t.accentStrong,
    '--auth-accent-text': t.accentText,
    '--auth-strong-surface-text': t.strongSurfaceText,
    '--auth-success': t.success,
    '--auth-success-strong': t.successStrong,
    '--auth-success-bg': t.successBg,
    '--auth-success-border': t.successBorder,
    '--auth-danger': t.danger,
    '--auth-danger-bg': t.dangerBg,
    '--auth-danger-border': t.dangerBorder,
    '--auth-warn': t.warn,
    '--auth-warn-strong': t.warnStrong,
    '--auth-warn-bg': t.warnBg,
    '--auth-warn-border': t.warnBorder,
    '--auth-overlay': t.overlay,
  };
}

export function resolveAuthenticatedThemeScope(pathname) {
  if (!pathname) return null;
  if (pathname.startsWith('/capacity')) return null;
  if (pathname.startsWith('/bananas') && pathname !== '/bananas/login') return 'admin';
  if (pathname.startsWith('/team') && pathname !== '/team/login') return 'team';
  return null;
}
