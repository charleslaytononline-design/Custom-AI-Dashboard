import { useEffect, useRef } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'

const IDLE_TIMEOUT_MS = 6 * 60 * 60 * 1000       // 6 hours
const ABSOLUTE_TIMEOUT_MS = 24 * 60 * 60 * 1000  // 24 hours
const CHECK_INTERVAL_MS = 5 * 60 * 1000            // check every 5 minutes
const STORAGE_KEY = 'session_started_at'

export function useSessionTimeout() {
  const router = useRouter()
  const lastActivity = useRef(Date.now())

  useEffect(() => {
    if (typeof window === 'undefined') return

    // Throttled activity tracker — update at most once per second
    let throttled = false
    const onActivity = () => {
      if (throttled) return
      throttled = true
      lastActivity.current = Date.now()
      setTimeout(() => { throttled = false }, 1000)
    }

    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'] as const
    events.forEach(e => window.addEventListener(e, onActivity, { passive: true }))

    const interval = setInterval(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return // not logged in, nothing to do

      const now = Date.now()

      // Check idle timeout
      if (now - lastActivity.current > IDLE_TIMEOUT_MS) {
        await signOut('idle')
        return
      }

      // Check absolute timeout
      const startedAt = localStorage.getItem(STORAGE_KEY)
      if (startedAt && now - Number(startedAt) > ABSOLUTE_TIMEOUT_MS) {
        await signOut('absolute')
        return
      }
    }, CHECK_INTERVAL_MS)

    async function signOut(reason: string) {
      localStorage.removeItem(STORAGE_KEY)
      await supabase.auth.signOut()
      router.push('/?reason=timeout')
    }

    return () => {
      events.forEach(e => window.removeEventListener(e, onActivity))
      clearInterval(interval)
    }
  }, [router])
}
