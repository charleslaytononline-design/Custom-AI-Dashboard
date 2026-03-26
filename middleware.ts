import { createMiddlewareSupabaseClient } from '@supabase/auth-helpers-nextjs'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Routes that require NO authentication (public)
const PUBLIC_ROUTES = [
  '/',                  // Login page
  '/reset-password',    // Password reset
]

// API routes that are public (webhooks, signup, etc.)
const PUBLIC_API_ROUTES = [
  '/api/signup',
  '/api/forgot-password',
  '/api/webhook',         // Stripe webhook (validates signature internally)
  '/api/cron/',           // Cron jobs (validate CRON_SECRET internally)
  '/api/log',             // Logging (auth is optional, handled internally)
  '/api/preview/',        // Page previews
]

// Routes that require admin role
const ADMIN_ROUTES = [
  '/admin',
]

export async function middleware(req: NextRequest) {
  const res = NextResponse.next()
  const { pathname } = req.nextUrl

  // Allow public pages
  if (PUBLIC_ROUTES.includes(pathname)) {
    return res
  }

  // Allow public API routes
  if (PUBLIC_API_ROUTES.some(route => pathname.startsWith(route))) {
    return res
  }

  // Allow static files and Next.js internals
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.includes('.')
  ) {
    return res
  }

  // Create authenticated Supabase client
  const supabase = createMiddlewareSupabaseClient({ req, res })
  const { data: { session } } = await supabase.auth.getSession()

  // No session = redirect to login (for pages) or 401 (for API)
  if (!session) {
    if (pathname.startsWith('/api/')) {
      return new NextResponse(
        JSON.stringify({ error: 'Not authenticated' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    }
    const loginUrl = new URL('/', req.url)
    return NextResponse.redirect(loginUrl)
  }

  // Admin route protection
  if (ADMIN_ROUTES.some(route => pathname.startsWith(route))) {
    // For admin pages, the page itself checks the role via getServerSideProps
    // This middleware just ensures there IS a session. The page handles role check.
    // API admin routes are protected by their own verifyAdmin() function.
  }

  return res
}

export const config = {
  matcher: [
    // Match all routes except static files
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
