-- Raise source file storage limit for card generator uploads (PDF, Office, video).
insert into storage.buckets (id, name, public, file_size_limit)
values ('pdfs', 'pdfs', false, 104857600)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit;
