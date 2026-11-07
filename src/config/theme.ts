export const colors = {
  primary: '#FFFFFF',
  primaryBright: '#FFFFFF',
  primarySoft: '#D9D9D9',
  primaryDeep: '#B3B3B3',
  primaryContrast: '#0B0B0F',
  bgDark: 'var(--bg-main)',
  panelDark: 'var(--bg-panel)',
  surfaceDark: 'var(--bg-surface)',
  textWhite: 'var(--text-main)',
  textMuted: 'var(--text-muted)',
  border: 'var(--border)',
  error: '#FF4D6A',
  success: '#4ADE80',
} as const;

export type ColorKey = keyof typeof colors;
