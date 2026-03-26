-- ============================================
-- Custom AI Dashboard v2 - Full Setup
-- Run this in Supabase SQL Editor
-- ============================================

-- Drop old tables if starting fresh
drop table if exists usage cascade;
drop table if exists pages cascade;
drop table if exists profiles cascade;
drop table if exists projects cascade;

-- Profiles table (one per user, created on signup)
create table profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  email text not null,
  role text not null default 'user',
  created_at timestamptz default now()
);

-- Projects table (like Lovable projects)
create table projects (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null default 'My Project',
  description text default '',
  layout_code text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Pages table (each project has multiple pages)
create table pages (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references projects(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null default 'Page 1',
  code text not null default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Usage tracking
create table usage (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  project_id uuid references projects(id) on delete set null,
  page_id uuid references pages(id) on delete set null,
  tokens integer not null default 0,
  created_at timestamptz default now()
);

-- ============================================
-- Row Level Security
-- ============================================

alter table profiles enable row level security;
alter table projects enable row level security;
alter table pages enable row level security;
alter table usage enable row level security;

-- Profiles: users see own, admin sees/updates all
create policy "users view own profile" on profiles for select using (auth.uid() = id);
create policy "users insert own profile" on profiles for insert with check (auth.uid() = id);
create policy "users update own profile" on profiles for update using (auth.uid() = id);
create policy "admin views all profiles" on profiles for select using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);
create policy "admin updates all profiles" on profiles for update using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);

-- Projects: users see only own
create policy "users view own projects" on projects for select using (auth.uid() = user_id);
create policy "users insert own projects" on projects for insert with check (auth.uid() = user_id);
create policy "users update own projects" on projects for update using (auth.uid() = user_id);
create policy "users delete own projects" on projects for delete using (auth.uid() = user_id);
create policy "admin views all projects" on projects for select using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);

-- Pages: users see only own, admin sees all
create policy "users view own pages" on pages for select using (auth.uid() = user_id);
create policy "users insert own pages" on pages for insert with check (auth.uid() = user_id);
create policy "users update own pages" on pages for update using (auth.uid() = user_id);
create policy "users delete own pages" on pages for delete using (auth.uid() = user_id);
create policy "admin views all pages" on pages for select using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);

-- Usage: users see own
create policy "users view own usage" on usage for select using (auth.uid() = user_id);
create policy "users insert own usage" on usage for insert with check (auth.uid() = user_id);
create policy "admin views all usage" on usage for select using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);

-- ============================================
-- Auto-create profile on signup
-- ============================================
create or replace function handle_new_user()
returns trigger as $$
declare
  free_plan_id uuid;
begin
  -- Find the Free plan (lowest price, first by sort_order)
  select id into free_plan_id
  from plans
  where price_monthly = 0
  order by sort_order asc
  limit 1;

  insert into profiles (id, email, role, plan_id)
  values (
    new.id,
    new.email,
    case when new.email = 'charleslayton.online@gmail.com' then 'admin' else 'user' end,
    free_plan_id
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ============================================
-- Indexes
-- ============================================
create index if not exists projects_user_id_idx on projects(user_id);
create index if not exists pages_project_id_idx on pages(project_id);
create index if not exists pages_user_id_idx on pages(user_id);
create index if not exists usage_user_id_idx on usage(user_id);
create index if not exists profiles_role_idx on profiles(role);

-- Done!

-- ============================================
-- AMENDMENTS — run these in Supabase SQL Editor
-- on your EXISTING database (already set up)
-- ============================================

-- 1. Allow admins to update any profile (needed for role promotion/demotion)
drop policy if exists "admin updates all profiles" on profiles;
create policy "admin updates all profiles" on profiles for update using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);

-- 2. Allow admins to view all pages (for admin monitoring)
drop policy if exists "admin views all pages" on pages;
create policy "admin views all pages" on pages for select using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);

-- 3. Add suspended column if missing
alter table profiles add column if not exists suspended boolean not null default false;
alter table profiles add column if not exists credit_balance numeric not null default 0;

-- ============================================
-- chat_history table (stores builder conversations)
-- Run this block if the table doesn't exist yet
-- ============================================
create table if not exists chat_history (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references projects(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  page_id uuid references pages(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  is_plan boolean not null default false,
  created_at timestamptz default now()
);

alter table chat_history enable row level security;

create policy "users manage own chat history" on chat_history
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "admin views all chat history" on chat_history
  for select using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

create index if not exists chat_history_page_id_idx on chat_history(page_id);
create index if not exists chat_history_user_id_idx on chat_history(user_id);

-- ============================================
-- page_versions table (version history / undo)
-- Run this block if the table doesn't exist yet
-- ============================================
create table if not exists page_versions (
  id uuid default gen_random_uuid() primary key,
  page_id uuid references pages(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  code text not null,
  source text not null default 'ai_build',  -- 'ai_build', 'manual_edit', 'restore'
  created_at timestamptz default now()
);

alter table page_versions enable row level security;

create policy "users manage own page versions" on page_versions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "admin views all page versions" on page_versions
  for select using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

create index if not exists page_versions_page_id_idx on page_versions(page_id);
create index if not exists page_versions_created_at_idx on page_versions(created_at);

-- ============================================
-- project_files table (virtual file system per project)
-- Run this block if the table doesn't exist yet
-- ============================================
create table if not exists project_files (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references projects(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  path text not null,                      -- e.g., 'pages/dashboard.html', 'styles/custom.css'
  content text,
  file_type text not null default 'html',  -- html, css, js, json, image, config
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(project_id, path)
);

alter table project_files enable row level security;

create policy "users manage own project files" on project_files
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "admin views all project files" on project_files
  for select using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

create index if not exists project_files_project_id_idx on project_files(project_id);
create index if not exists project_files_path_idx on project_files(project_id, path);

-- ============================================
-- deployments table (deployment history)
-- Run this block if the table doesn't exist yet
-- ============================================
create table if not exists deployments (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references projects(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  url text not null,
  status text not null default 'success',  -- success, failed
  provider text not null default 'vercel', -- vercel, netlify
  metadata jsonb,
  created_at timestamptz default now()
);

alter table deployments enable row level security;

create policy "users manage own deployments" on deployments
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists deployments_project_id_idx on deployments(project_id);