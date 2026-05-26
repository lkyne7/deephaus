-- Extend supported source types for Office documents and video.
alter table public.sources drop constraint if exists sources_type_check;
alter table public.sources add constraint sources_type_check
  check (type in ('text', 'pdf', 'docx', 'pptx', 'video'));
