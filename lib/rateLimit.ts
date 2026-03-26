/**
 * In-memory sliding window rate limiter.
 * For single-instance deployments (Vercel serverless has per-instance memory).
 * For multi-instance, upgrade to Redis or DB-backed limiter.
 */

const windows = new Map<string, number[]>()

// Clean up old entries periodically to prevent memory leaks
let lastCleanup = Date.now()
const CLEANUP_INTERVAL = 60_000 // 1 minute

function cleanup() {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL) return
  lastCleanup = now
  const cutoff = now - 300_000 // 5 minute max window
  const keys = Array.from(windows.keys())
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    const timestamps = windows.get(key)
    if (!timestamps) continue
    const valid = timestamps.filter(t => t > cutoff)
    if (valid.length === 0) {
      windows.delete(key)
    } else {
      windows.set(key, valid)
    }
  }
}

/**
 * Check if a request is within rate limits.
 * @param key - Unique key (e.g., `build:${userId}`)
 * @param maxRequests - Max requests allowed in the window
 * @param windowMs - Window size in milliseconds
 * @returns true if allowed, false if rate limited
 */
export function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  cleanup()
  const now = Date.now()
  const timestamps = windows.get(key) || []
  const valid = timestamps.filter(t => t > now - windowMs)

  if (valid.length >= maxRequests) return false

  valid.push(now)
  windows.set(key, valid)
  return true
}

/**
 * Get remaining requests in current window.
 */
export function getRemainingRequests(key: string, maxRequests: number, windowMs: number): number {
  const now = Date.now()
  const timestamps = windows.get(key) || []
  const valid = timestamps.filter(t => t > now - windowMs)
  return Math.max(0, maxRequests - valid.length)
}
