create extension if not exists pgcrypto;

create table if not exists public.library_folders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  parent_id uuid references public.library_folders(id) on delete cascade,
  created_at timestamptz not null default now()
);

create unique index if not exists library_folders_owner_parent_name
  on public.library_folders (owner_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

create table if not exists public.library_documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  folder_id uuid references public.library_folders(id) on delete set null,
  name text not null,
  storage_path text not null unique,
  content_type text not null default 'application/octet-stream',
  size_bytes bigint not null check (size_bytes >= 0),
  relative_path text not null default '',
  favorite boolean not null default false,
  status text not null default 'unread' check (status in ('unread', 'read')),
  added_at timestamptz not null default now(),
  last_opened timestamptz
);

alter table public.library_documents
  add column if not exists content_sha256 text;

create index if not exists library_documents_owner_added
  on public.library_documents (owner_id, added_at desc);
create index if not exists library_documents_owner_folder
  on public.library_documents (owner_id, folder_id);
create unique index if not exists library_documents_owner_content_sha256
  on public.library_documents (owner_id, content_sha256)
  where content_sha256 is not null;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.library_folders to authenticated;
grant select, insert, update, delete on public.library_documents to authenticated;

drop function if exists public.user_owns_library_folder(uuid, uuid);
create or replace function public.user_owns_library_folder(folder_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select exists (
    select 1 from public.library_folders folder
    where folder.id = folder_uuid and folder.owner_id = (select auth.uid())
  );
$$;

revoke all on function public.user_owns_library_folder(uuid) from public;
grant execute on function public.user_owns_library_folder(uuid) to authenticated;

alter table public.library_folders enable row level security;
alter table public.library_documents enable row level security;

drop policy if exists "Users manage their own folders" on public.library_folders;
create policy "Users manage their own folders"
  on public.library_folders for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and (parent_id is null or public.user_owns_library_folder(parent_id))
  );

drop policy if exists "Users manage their own documents" on public.library_documents;
create policy "Users manage their own documents"
  on public.library_documents for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and (folder_id is null or public.user_owns_library_folder(folder_id))
  );

insert into storage.buckets (id, name, public, file_size_limit)
values ('library-files', 'library-files', false, 52428800)
on conflict (id) do update
set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists "Users read their own library files" on storage.objects;
create policy "Users read their own library files"
  on storage.objects for select to authenticated
  using (bucket_id = 'library-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Users upload their own library files" on storage.objects;
create policy "Users upload their own library files"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'library-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Users delete their own library files" on storage.objects;
create policy "Users delete their own library files"
  on storage.objects for delete to authenticated
  using (bucket_id = 'library-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
