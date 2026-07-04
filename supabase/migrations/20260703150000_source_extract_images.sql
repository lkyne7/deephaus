-- Per-source option: inline images from the original document (PDF/DOCX/PPTX)
-- into the editable notes. Chosen at upload time on the Create page.
alter table public.sources
  add column if not exists extract_images boolean not null default true;
