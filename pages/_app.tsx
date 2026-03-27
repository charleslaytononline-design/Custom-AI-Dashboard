import type { AppProps } from 'next/app'
import { useEffect } from 'react'
import Head from 'next/head'
import '../styles/globals.css'
import { useSessionTimeout } from '../hooks/useSessionTimeout'
import { ThemeProvider } from '../contexts/ThemeContext'

function sendLog(event_type: string, severity: string, message: string, metadata?: object) {
  // Fire-and-forget — don't await, don't block the UI
  fetch('/api/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event_type, severity, message, metadata }),
  }).catch(() => {/* silently ignore if log API is down */})
}

export default function App({ Component, pageProps }: AppProps) {
  useSessionTimeout()

  useEffect(() => {
    if (typeof window === 'undefined') return

    // Track recently sent messages to avoid duplicate log spam
    const recent = new Set<string>()
    function dedupe(key: string): boolean {
      if (recent.has(key)) return false
      recent.add(key)
      setTimeout(() => recent.delete(key), 10_000)
      return true
    }

    // Unhandled JS exceptions
    const onError = (event: ErrorEvent) => {
      const key = `err:${event.message}`
      if (!dedupe(key)) return
      sendLog('unhandled_error', 'error', event.message, {
        filename: event.filename,
        line: event.lineno,
        col: event.colno,
      })
    }

    // Unhandled promise rejections
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const msg = event.reason?.message || String(event.reason) || 'Unhandled rejection'
      const key = `rej:${msg}`
      if (!dedupe(key)) return
      sendLog('unhandled_error', 'error', msg, { stack: event.reason?.stack })
    }

    // console.error override
    const origError = console.error
    console.error = (...args: unknown[]) => {
      origError(...args)
      const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')
      const key = `cerr:${msg.slice(0, 120)}`
      if (dedupe(key)) {
        sendLog('console_error', 'error', msg.slice(0, 500))
      }
    }

    // console.warn override
    const origWarn = console.warn
    console.warn = (...args: unknown[]) => {
      origWarn(...args)
      const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')
      const key = `cwarn:${msg.slice(0, 120)}`
      if (dedupe(key)) {
        sendLog('console_error', 'warn', msg.slice(0, 500))
      }
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)

    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
      console.error = origError
      console.warn = origWarn
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
