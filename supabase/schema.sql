-- Run this once in the Supabase SQL editor.
-- Folio does not store every book. It keeps the ones it has already recommended,
-- plus each search, so repeat visits and the shelf can get faster later.
-- The API uses the service role key, which bypasses these policies.

create table if not exists public.books (
  id text primary key,
  title text not null,
  authors text,
  description text,
  cover_url text,
  published_year integer,
  info_url text,
  why text,
  updated_at timestamptz not null default now()
);

create table if not exists public.searches (
  id uuid primary key default gen_random_uuid(),
  query text,
  genres text[] not null default '{}',
  tropes text[] not null default '{}',
  movies text[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.books enable row level security;
alter table public.searches enable row level security;
