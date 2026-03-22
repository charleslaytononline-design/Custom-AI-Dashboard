import { createBrowserSupabaseClient } from '@supabase/auth-helpers-nextjs'

// Cookie-based session storage — enables server-side auth checks in getServerSideProps
export const supabase = createBrowserSupabaseClient()
