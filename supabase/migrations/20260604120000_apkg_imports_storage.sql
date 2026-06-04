-- Temporary storage for large Anki .apkg uploads (client uploads directly; server imports from here).

insert into storage.buckets (id, name, public, file_size_limit)
values ('apkg-imports', 'apkg-imports', false, 10737418240)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit;

drop policy if exists "Users upload own apkg imports" on storage.objects;
drop policy if exists "Users read own apkg imports" on storage.objects;
drop policy if exists "Users update own apkg imports" on storage.objects;
drop policy if exists "Users delete own apkg imports" on storage.objects;

create policy "Users upload own apkg imports"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'apkg-imports'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users read own apkg imports"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'apkg-imports'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users update own apkg imports"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'apkg-imports'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'apkg-imports'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users delete own apkg imports"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'apkg-imports'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
