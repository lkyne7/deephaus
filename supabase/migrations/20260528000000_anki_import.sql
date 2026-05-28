-- Allow sources created by the Anki (.apkg) importer.
alter table public.sources drop constraint if exists sources_type_check;
alter table public.sources add constraint sources_type_check
  check (type in ('text', 'pdf', 'docx', 'pptx', 'video', 'youtube', 'apkg'));
