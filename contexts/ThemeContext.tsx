import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { Theme, ThemeColors, applyTheme, getDefaultTheme, DEFAULT_THEMES } from '../lib/themes'
import { supabase } from '../lib/supabase'

interface ThemeContextValue {
  theme: Theme
  setTheme: (theme: Theme) => void
  availableThemes: Theme[]
  refreshThemes: () => Promise<void>
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const STORAGE_KEY = 'custom-ai-theme'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getDefaultTheme())
  const [availableThemes, setAvailableThemes] = useState<Theme[]>(DEFAULT_THEMES)

  // Load saved theme from localStorage on mount (instant, before DB)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved) as Theme
        setThemeState(parsed)
        applyTheme(parsed.colors)
      } else {
        applyTheme(getDefaultTheme().colors)
      }
    } catch {
      applyTheme(getDefaultTheme().colors)
    }
  }, [])

  // Load user's theme from DB after auth resolves
  useEffect(() => {
    async function loadUserTheme() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: profile } = await supabase
        .from('profiles')
        .select('theme_id')
        .eq('id', user.id)
        .single()

      if (profile?.theme_id) {
        const { data: dbTheme } = await supabase
          .from('color_themes')
          .select('*')
          .eq('id', profile.theme_id)
          .single()

        if (dbTheme) {
          const t: Theme = {
            id: dbTheme.id,
            name: dbTheme.name,
            colors: dbTheme.colors as ThemeColors,
            is_builtin: dbTheme.is_builtin,
            is_available: dbTheme.is_available,
          }
          setThemeState(t)
          applyTheme(t.colors)
          localStorage.setItem(STORAGE_KEY, JSON.stringify(t))
        }
      }
    }
    loadUserTheme().catch(() => {})
  }, [])

  const refreshThemes = useCallback(async () => {
    const { data } = await supabase
      .from('color_themes')
      .select('*')
      .eq('is_available', true)
      .order('sort_order', { ascending: true })

    if (data && data.length > 0) {
      setAvailableThemes(data.map(d => ({
        id: d.id,
        name: d.name,
        colors: d.colors as ThemeColors,
        is_builtin: d.is_builtin,
        is_available: d.is_available,
        sort_order: d.sort_order,
      })))
    } else {
      // Fallback to built-in themes if DB not set up yet
      setAvailableThemes(DEFAULT_THEMES)
    }
  }, [])

  // Load available themes on mount
  useEffect(() => {
    refreshThemes().catch(() => {})
  }, [refreshThemes])

  const setTheme = useCallback(async (newTheme: Theme) => {
    setThemeState(newTheme)
    applyTheme(newTheme.colors)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newTheme))

    // Persist to DB
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      await supabase
        .from('profiles')
        .update({ theme_id: newTheme.id })
        .eq('id', user.id)
    }
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, setTheme, availableThemes, refreshThemes }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}
