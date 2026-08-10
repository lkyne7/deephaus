-- Offline-first note edits bypass PUT /api/sources/:id/document (which cleared
-- source_chunks inline). Invalidate the chunk/embedding cache in the database
-- instead so every write path — API or replicated PowerSync upload — rebuilds
-- chunks on the next generation.

create or replace function public.invalidate_source_chunks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.source_chunks where source_id = new.id;
  return new;
end;
$$;

drop trigger if exists sources_invalidate_chunks on public.sources;
create trigger sources_invalidate_chunks
after update of content_edited_at on public.sources
for each row
when (new.content_edited_at is distinct from old.content_edited_at)
execute function public.invalidate_source_chunks();
