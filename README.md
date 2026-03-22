# Custom AI Dashboard

A Lovable-style AI app builder. Users log in, get their own sandboxed workspace, and build pages using AI chat commands.

---

## Deploy Today — Step by Step

### Step 1: Supabase (10 minutes)

1. Go to **supabase.com** → New project
2. Give it a name (e.g. "custom-ai-dashboard"), set a password, choose a region
3. Wait ~2 minutes for it to spin up
4. Go to **SQL Editor** → New query
5. Paste the entire contents of `supabase-setup.sql` and click **Run**
6. Go to **Settings → API** and copy:
   - `Project URL` → this is your `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → this is your `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### Step 2: GitHub (5 minutes)

1. Create a new repository on github.com (e.g. "custom-ai-dashboard")
2. Upload all these files to it (drag and drop in GitHub works fine)

### Step 3: Vercel (5 minutes)

1. Go to **vercel.com** → New Project
2. Import your GitHub repository
3. Framework preset: **Next.js** (auto-detected)
4. Add these **Environment Variables**:

```
NEXT_PUBLIC_SUPABASE_URL        = (paste from Supabase)
NEXT_PUBLIC_SUPABASE_ANON_KEY   = (paste from Supabase)
ANTHROPIC_API_KEY               = (your Claude API key)
```

5. Click **Deploy** → Done! You get a live URL instantly.

### Step 4: Enable Supabase Auth emails (5 minutes)

1. In Supabase → **Authentication → Email Templates**
2. Set your site URL to your Vercel URL (e.g. https://your-app.vercel.app)
3. Users can now sign up and get confirmation emails

---

## What users can do

- Sign up / log in
- Create multiple pages
- Type AI commands to build anything on each page
- All pages are sandboxed — users only see their own data
- Changes save automatically

---

## Adding Stripe billing later

When you're ready to charge users:

1. Add a `stripe_customer_id` column to your users table
2. Use Stripe Metered Billing — charge per 1000 tokens
3. The `usage` table already tracks tokens per user — just read from it at billing time

---

## Environment Variables Summary

| Variable | Where to get it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API |
| `ANTHROPIC_API_KEY` | console.anthropic.com |
