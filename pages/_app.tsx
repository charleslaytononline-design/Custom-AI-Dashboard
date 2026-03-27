import type { AppProps } from 'next/app'
import { useEffect } from 'react'
import Head from 'next/head'
import '../styles/globals.css'
import { useSessionTimeout } from '../hooks/useSessionTimeout'
import { ThemeProvider } from '../contexts/ThemeContext'
import { supabase } from '../lib/supabase'

// Module-level email cache — populated when auth session is detected
let _userEmail: string | null = null

// Batch log entries and flush every 30 seconds (or on page unload)
const logQueue: Array<{ event_type: string; severity: string; message: string; email?: string | null; metadata?: object }> = []
let flushTimer: ReturnType<typeof setTimeout> | null = null

function flushLogs() {
  if (logQueue.length === 0) return
  const batch = logQueue.splice(0)
  // Send each entry individually for API compat (previous code had a bug that dropped all but the first)
  for (const entry of batch) {
    const body = JSON.stringify(entry)
    if (typeof navigator?.sendBeacon === 'function' && document.visibilityState === 'hidden') {
      navigator.sendBeacon('/api/log', new Blob([body], { type: 'application/json' }))
    } else {
      fetch('/api/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }).catch(() => {})
    }
  }
  // If more remain in queue (from concurrent adds), schedule another flush
  if (logQueue.length > 0) scheduleFlush()
}

function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(() => { flushTimer = null; flushLogs() }, 30_000)
}

function sendLog(event_type: string, severity: string, message: string, metadata?: object) {
  logQueue.push({ event_type, severity, message, email: _userEmail || undefined, metadata })
  // Flush errors immediately, batch warnings/info
  if (severity === 'error') { if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }; flushLogs() }
  else scheduleFlush()
}

// Known bot/noise patterns to ignore in warning logs (Vercel screenshot bot)
const IGNORED_WARN_PATTERNS = [
  'autoconsent already initialized',
]

export default function App({ Component, pageProps }: AppProps) {
  useSessionTimeout()

  useEffect(() => {
    if (typeof window === 'undefined') return

    // Populate email from current auth session
    supabase.auth.getSession().then(({ data }) => {
      _userEmail = data.session?.user?.email || null
    })
    // Keep email in sync on auth state changes (login/logout)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      _userEmail = session?.user?.email || null
    })

    // Track recently sent messages to avoid duplicate log spam
    const recent = new Set<string>()
    function dedupe(key: string): boolean {
      if (recent.has(key)) return false
      recent.add(key)
      setTimeout(() => recent.delete(key), 10_000)
      return true
    }

    // Helper: get current page context for all log entries
    const getPageContext = () => ({
      url: window.location.pathname + window.location.search,
      referrer: document.referrer || undefined,
    })

    // Unhandled JS exceptions
    const onError = (event: ErrorEvent) => {
      const key = `err:${event.message}`
      if (!dedupe(key)) return
      sendLog('unhandled_error', 'error', event.message?.slice(0, 1000) || 'Unknown error', {
        ...getPageContext(),
        filename: event.filename,
        line: event.lineno,
        col: event.colno,
        stack: event.error?.stack?.slice(0, 1000),
      })
    }

    // Unhandled promise rejections
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const msg = event.reason?.message || String(event.reason) || 'Unhandled rejection'
      const key = `rej:${msg}`
      if (!dedupe(key)) return
      sendLog('unhandled_error', 'error', msg.slice(0, 1000), {
        ...getPageContext(),
        stack: event.reason?.stack?.slice(0, 1000),
        type: typeof event.reason === 'object' ? event.reason?.constructor?.name : typeof event.reason,
      })
    }

    // console.error override
    const origError = console.error
    console.error = (...args: unknown[]) => {
      origError(...args)
      let msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')
      const callerStack = new Error().stack?.split('\n').slice(2, 8).join('\n')

      // Enrich useless empty error messages
      if (msg === '{}' || msg === '' || msg === 'undefined') {
        msg = `Empty error object logged at ${window.location.pathname} | stack: ${callerStack?.split('\n')[0] || 'unknown'}`
      } else if (msg === '{"cancelled":true}') {
        msg = `Operation cancelled at ${window.location.pathname}`
      }

      const key = `cerr:${msg.slice(0, 120)}`
      if (dedupe(key)) {
        sendLog('console_error', 'error', msg.slice(0, 1000), {
          ...getPageContext(),
          callerStack,
        })
      }
    }

    // console.warn override
    const origWarn = console.warn
    console.warn = (...args: unknown[]) => {
      origWarn(...args)
      const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')

      // Skip known bot/noise warnings
      if (IGNORED_WARN_PATTERNS.some(p => msg.includes(p))) return

      const key = `cwarn:${msg.slice(0, 120)}`
      if (dedupe(key)) {
        const callerStack = new Error().stack?.split('\n').slice(2, 8).join('\n')
        sendLog('console_error', 'warn', msg.slice(0, 1000), {
          ...getPageContext(),
          callerStack,
        })
      }
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)

    // Flush buffered logs when page goes hidden (tab switch, close)
    const onVisChange = () => { if (document.visibilityState === 'hidden') flushLogs() }
    document.addEventListener('visibilitychange', onVisChange)

    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
      document.removeEventListener('visibilitychange', onVisChange)
      console.error = origError
      console.warn = origWarn
      subscription.unsubscribe()
      flushLogs()
    }
  }, [])

  const getLayout = (Component as any).getLayout ?? ((page: React.ReactNode) => page)
  return (
    <ThemeProvider>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, viewport-fit=cover" />
      </Head>
      {getLayout(<Component {...pageProps} />)}
    </ThemeProvider>
  )
}
