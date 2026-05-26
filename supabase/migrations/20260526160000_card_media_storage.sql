-- Public card image storage (URLs embedded in card text fields as markdown)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'card-media',
  'card-media',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Card media public read" on storage.objects;
drop policy if exists "Users upload own card media" on storage.objects;
drop policy if exists "Users update own card media" on storage.objects;
drop policy if exists "Users delete own card media" on storage.objects;

create policy "Card media public read"
  on storage.objects for select
  to public
  using (bucket_id = 'card-media');

create policy "Users upload own card media"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'card-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users update own card media"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'card-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'card-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users delete own card media"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'card-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
