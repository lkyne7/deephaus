-- Multi-source decks: PDF previews for Office originals and extraction job kinds.
--
-- `sources.preview_storage_path` points at a worker-generated PDF rendition of
-- a DOCX/PPTX original (stored next to it in the private `pdfs` bucket) so the
-- browser can display Office documents inline.
--
-- `source_extraction_jobs.kind` distinguishes full hybrid PDF extraction jobs
-- ('extract') from lightweight LibreOffice preview conversions ('preview') that
-- share the same durable queue and worker.

alter table public.sources
  add column if not exists preview_storage_path text;

alter table public.source_extraction_jobs
  add column if not exists kind text not null default 'extract';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'source_extraction_jobs_kind_check'
  ) then
    alter table public.source_extraction_jobs
      add constraint source_extraction_jobs_kind_check
      check (kind in ('extract', 'preview'));
  end if;
end $$;
