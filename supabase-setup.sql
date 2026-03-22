-- ============================================
-- Custom AI Dashboard - Supabase Setup
-- Paste this entire file into:
-- Supabase Dashboard > SQL Editor > New Query
-- Then click "Run"
-- ============================================

-- Pages table: stores each user's pages and their generated code
create table if not exists pages (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null default 'My Page',
  code text not null default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Usage table: tracks token usage per user per page
create table if not exists usage (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  page_id uuid references pages(id) on delete set null,
  tokens integer not null default 0,
  created_at timestamptz default now()
);

-- Row Level Security: users can only see/edit their own data
alter table pages enable row level security;
alter table usage enable row level security;

-- Pages policies
create policy "Users can view own pages"
  on pages for select using (auth.uid() = user_id);

create policy "Users can insert own pages"
  on pages for insert with check (auth.uid() = user_id);

create policy "Users can update own pages"
  on pages for update using (auth.uid() = user_id);

create policy "Users can delete own pages"
  on pages for delete using (auth.uid() = user_id);

-- Usage policies
create policy "Users can view own usage"
  on usage for select using (auth.uid() = user_id);

create policy "Users can insert own usage"
  on usage for insert with check (auth.uid() = user_id);

-- Index for faster queries
create index if not exists pages_user_id_idx on pages(user_id);
create index if not exists usage_user_id_idx on usage(user_id);

-- Done! Your database is ready.
