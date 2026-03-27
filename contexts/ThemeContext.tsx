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
      setAvailableThemes(DEFAULT_THEMES)
    }
  }, [])

  // Load user theme + available themes in a single effect with parallel queries
  useEffect(() => {
    async function loadThemeData() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        // Not logged in — just load available themes
        refreshThemes().catch(() => {})
        return
      }

      // Fetch user profile theme + available themes in parallel
      const [profileRes, themesRes] = await Promise.all([
        supabase.from('profiles').select('theme_id').eq('id', user.id).single(),
        supabase.from('color_themes').select('*').eq('is_available', true).order('sort_order', { ascending: true }),
      ])

      // Set available themes
      if (themesRes.data && themesRes.data.length > 0) {
        const allThemes = themesRes.data.map(d => ({
          id: d.id, name: d.name, colors: d.colors as ThemeColors,
          is_builtin: d.is_builtin, is_available: d.is_available, sort_order: d.sort_order,
        }))
        setAvailableThemes(allThemes)

        // Set user's selected theme from the already-fetched themes list
        if (profileRes.data?.theme_id) {
          const userTheme = allThemes.find(t => t.id === profileRes.data!.theme_id)
          if (userTheme) {
            setThemeState(userTheme)
            applyTheme(userTheme.colors)
            localStorage.setItem(STORAGE_KEY, JSON.stringify(userTheme))
          }
        }
      } else {
        setAvailableThemes(DEFAULT_THEMES)
      }
    }
    loadThemeData().catch(() => {})
  }, [])

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
