-- Run this once in the Supabase SQL editor.
-- Booksrec does not store every book. It keeps the ones it has already recommended,
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

-- Community: one shared room. Run this in the Supabase SQL editor too.
-- Profiles are created when someone signs up with email.
-- In Authentication → Providers, keep Email turned on.
-- In Authentication → URL configuration, set the site URL to the Vercel address.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists posts_created_at on public.posts (created_at desc);
create index if not exists comments_post_id on public.comments (post_id, created_at);

alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.comments enable row level security;

grant select on public.profiles to anon, authenticated;
grant insert, update on public.profiles to authenticated;
grant select on public.posts to anon, authenticated;
grant insert, delete on public.posts to authenticated;
grant select on public.comments to anon, authenticated;
grant insert, delete on public.comments to authenticated;

drop policy if exists "profiles are visible" on public.profiles;
drop policy if exists "members read their own profile" on public.profiles;
drop policy if exists "members create their profile" on public.profiles;
drop policy if exists "members rename themselves" on public.profiles;
create policy "members read their own profile" on public.profiles for select using (auth.uid() = id);
create policy "members create their profile" on public.profiles for insert with check (auth.uid() = id);
create policy "members rename themselves" on public.profiles for update using (auth.uid() = id);

-- Names are public. Email stays on the profile row and is only readable by that member.
create or replace view public.member_names
with (security_invoker = false) as
  select id, name from public.profiles;

grant select on public.member_names to anon, authenticated;

drop policy if exists "posts are visible" on public.posts;
drop policy if exists "members write posts" on public.posts;
drop policy if exists "authors delete posts" on public.posts;
create policy "posts are visible" on public.posts for select using (true);
create policy "members write posts" on public.posts for insert with check (auth.uid() = author_id);
create policy "authors delete posts" on public.posts for delete using (auth.uid() = author_id);

drop policy if exists "comments are visible" on public.comments;
drop policy if exists "members write comments" on public.comments;
drop policy if exists "authors delete comments" on public.comments;
create policy "comments are visible" on public.comments for select using (true);
create policy "members write comments" on public.comments for insert with check (auth.uid() = author_id);
create policy "authors delete comments" on public.comments for delete using (auth.uid() = author_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), split_part(coalesce(new.email, 'reader'), '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

do $$
begin
  alter publication supabase_realtime add table public.posts;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.comments;
exception
  when duplicate_object then null;
end $$;

-- Profile pictures and a host who can remove any post.
-- Run this again in the SQL editor if the community tables already exist.
-- The earliest profile becomes the host. Later members cannot take that role.

alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists is_owner boolean not null default false;

create or replace function public.keep_owner_flag()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.is_owner := false;
    end if;
    return new;
  end if;
  if auth.uid() is not null then
    new.is_owner := old.is_owner;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_keep_owner_flag on public.profiles;
create trigger profiles_keep_owner_flag
  before insert or update on public.profiles
  for each row execute function public.keep_owner_flag();

update public.profiles
set is_owner = true
where not exists (select 1 from public.profiles where is_owner)
  and id = (select id from public.profiles order by created_at asc limit 1);

create or replace view public.member_names
with (security_invoker = false) as
  select id, name, avatar_url from public.profiles;

grant select on public.member_names to anon, authenticated;

drop policy if exists "authors delete posts" on public.posts;
create policy "authors delete posts" on public.posts
  for delete using (
    auth.uid() = author_id
    or exists (
      select 1 from public.profiles as host
      where host.id = auth.uid() and host.is_owner
    )
  );

drop policy if exists "authors delete comments" on public.comments;
create policy "authors delete comments" on public.comments
  for delete using (
    auth.uid() = author_id
    or exists (
      select 1 from public.profiles as host
      where host.id = auth.uid() and host.is_owner
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "anyone can view avatars" on storage.objects;
create policy "anyone can view avatars" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "members upload their avatar" on storage.objects;
create policy "members upload their avatar" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "members replace their avatar" on storage.objects;
create policy "members replace their avatar" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "members delete their avatar" on storage.objects;
create policy "members delete their avatar" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
