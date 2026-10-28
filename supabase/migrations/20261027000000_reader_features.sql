alter table public.library_documents
  add column if not exists reading_progress jsonb;

create table if not exists public.reader_annotations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null references public.library_documents(id) on delete cascade,
  kind text not null check (kind in ('bookmark', 'note')),
  body text not null default '' check (char_length(body) <= 5000),
  location jsonb not null,
  created_at timestamptz not null default now(),
  check (kind <> 'note' or char_length(trim(body)) > 0)
);

create index if not exists reader_annotations_owner_document_created
  on public.reader_annotations (owner_id, document_id, created_at desc);

grant select, insert, update, delete on public.reader_annotations to authenticated;

alter table public.reader_annotations enable row level security;

drop policy if exists "Users manage their own reader annotations" on public.reader_annotations;
create policy "Users manage their own reader annotations"
  on public.reader_annotations for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.library_documents document
      where document.id = reader_annotations.document_id
        and document.owner_id = (select auth.uid())
    )
  );
