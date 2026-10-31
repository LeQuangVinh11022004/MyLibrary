revoke all privileges
  on table public.library_folders, public.library_documents, public.reader_annotations
  from anon, public;

grant select, insert, update, delete on public.library_folders to authenticated;
grant select, insert, update, delete on public.library_documents to authenticated;
grant select, insert, update, delete on public.reader_annotations to authenticated;
