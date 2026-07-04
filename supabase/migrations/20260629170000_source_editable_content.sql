-- Make the extracted source material editable (Notion-style) on the Create page.
-- edited_content holds the canonical TipTap/ProseMirror document the user edits;
-- raw_text continues to hold the derived plain text used for chunking/embeddings
-- and generation, so the rest of the pipeline is unchanged.

alter table public.sources
  add column if not exists edited_content jsonb,
  add column if not exists content_edited_at timestamptz;
