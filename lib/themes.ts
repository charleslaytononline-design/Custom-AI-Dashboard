export interface ThemeColors {
  bg: string
  bg2: string
  bg3: string
  border: string
  border2: string
  text: string
  text2: string
  text3: string
  accent: string
  accent2: string
  success: string
  warning: string
  danger: string
}

export interface Theme {
  id: string
  name: string
  colors: ThemeColors
  is_builtin: boolean
  is_available: boolean
  sort_order?: number
}

export const DEFAULT_THEMES: Theme[] = [
  {
    id: 'builtin-dark-default',
    name: 'Dark Default',
    is_builtin: true,
    is_available: true,
    sort_order: 0,
    colors: {
      bg: '#0f0f0f',
      bg2: '#1a1a1a',
      bg3: '#242424',
      border: 'rgba(255,255,255,0.08)',
      border2: 'rgba(255,255,255,0.14)',
      text: '#ffffff',
      text2: '#c0c0c0',
      text3: '#909090',
      accent: '#7c6ef7',
      accent2: '#5b50d6',
      success: '#1D9E75',
      warning: '#BA7517',
      danger: '#A32D2D',
    },
  },
  {
    id: 'builtin-midnight-blue',
    name: 'Midnight Blue',
    is_builtin: true,
    is_available: true,
    sort_order: 1,
    colors: {
      bg: '#0a0e1a',
      bg2: '#111827',
      bg3: '#1e293b',
      border: 'rgba(148,163,184,0.12)',
      border2: 'rgba(148,163,184,0.2)',
      text: '#ffffff',
      text2: '#cbd5e1',
      text3: '#94a3b8',
      accent: '#3b82f6',
      accent2: '#2563eb',
      success: '#22c55e',
      warning: '#eab308',
      danger: '#ef4444',
    },
  },
  {
    id: 'builtin-charcoal',
    name: 'Charcoal',
    is_builtin: true,
    is_available: true,
    sort_order: 2,
    colors: {
      bg: '#121210',
      bg2: '#1c1c18',
      bg3: '#262620',
      border: 'rgba(255,245,225,0.08)',
      border2: 'rgba(255,245,225,0.14)',
      text: '#ffffff',
      text2: '#c8c0b0',
      text3: '#908878',
      accent: '#f59e0b',
      accent2: '#d97706',
      success: '#22c55e',
      warning: '#f59e0b',
      danger: '#ef4444',
    },
  },
  {
    id: 'builtin-light',
    name: 'Light',
    is_builtin: true,
    is_available: true,
    sort_order: 3,
    colors: {
      bg: '#ffffff',
      bg2: '#f5f5f5',
      bg3: '#e8e8e8',
      border: 'rgba(0,0,0,0.1)',
      border2: 'rgba(0,0,0,0.18)',
      text: '#1a1a1a',
      text2: '#4a4a4a',
      text3: '#7a7a7a',
      accent: '#6c5ce7',
      accent2: '#5a4bd1',
      success: '#0d9668',
      warning: '#b45309',
      danger: '#dc2626',
    },
  },
]

const CSS_VAR_MAP: Record<keyof ThemeColors, string> = {
  bg: '--bg',
  bg2: '--bg-2',
  bg3: '--bg-3',
  border: '--border',
  border2: '--border-2',
  text: '--text',
  text2: '--text-2',
  text3: '--text-3',
  accent: '--accent',
  accent2: '--accent-2',
  success: '--success',
  warning: '--warning',
  danger: '--danger',
}

export function applyTheme(colors: ThemeColors) {
  if (typeof document === 'undefined') return
  const root = document.documentElement.style
  for (const [key, cssVar] of Object.entries(CSS_VAR_MAP)) {
    root.setProperty(cssVar, colors[key as keyof ThemeColors])
  }

  // Derived semi-transparent accent/danger variables.
  // These use color-mix() which works via setProperty() but NOT in React inline styles.
  // Components reference these as var(--accent-7), var(--accent-10), etc.
  const derived: Record<string, string> = {
    '--accent-7':  'color-mix(in srgb, var(--accent) 7%, transparent)',
    '--accent-10': 'color-mix(in srgb, var(--accent) 10%, transparent)',
    '--accent-15': 'color-mix(in srgb, var(--accent) 15%, transparent)',
    '--accent-20': 'color-mix(in srgb, var(--accent) 20%, transparent)',
    '--accent-30': 'color-mix(in srgb, var(--accent) 30%, transparent)',
    '--danger-12': 'color-mix(in srgb, var(--danger) 12%, transparent)',
    '--danger-25': 'color-mix(in srgb, var(--danger) 25%, transparent)',
  }
  for (const [cssVar, value] of Object.entries(derived)) {
    root.setProperty(cssVar, value)
  }
}

export function getDefaultTheme(): Theme {
  return DEFAULT_THEMES[0]
}
