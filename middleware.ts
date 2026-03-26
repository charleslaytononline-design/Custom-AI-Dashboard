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

  // Skip page access checks for API routes (they handle their own auth)
  if (pathname.startsWith('/api/')) {
    return res
  }

  // Role-based page access enforcement
  // Look up user's profile to get their role, then check page access
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', session.user.id)
    .single()

  if (profile?.role) {
    // Get role record
    const { data: role } = await supabase
      .from('roles')
      .select('id, can_access_admin')
      .eq('name', profile.role)
      .single()

    if (role) {
      // Check page access for this role
      // Normalize path: /project/abc123 -> /project
      const basePath = '/' + pathname.split('/').filter(Boolean)[0]
      const { data: access } = await supabase
        .from('role_page_access')
        .select('can_access')
        .eq('role_id', role.id)
        .eq('page_path', basePath)
        .single()

      // If this page is registered and access is denied, redirect
      if (access && !access.can_access) {
        const homeUrl = new URL('/home', req.url)
        return NextResponse.redirect(homeUrl)
      }
    }
  }

  return res
}

export const config = {
  matcher: [
    // Match all routes except static files
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
