-- Persist source chunks (with embeddings) and link every card to the exact
-- source segment it was generated from. Powers "View source" and semantic
-- retrieval over a user's uploaded notes/textbooks.

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- source_chunks: one row per chunk produced by buildSourceChunks(). Indices
-- match the deterministic chunk order so generation can link cards by index.
-- ---------------------------------------------------------------------------
create table if not exists public.source_chunks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id) on delete cascade,
  chunk_index int not null,
  source_ref text not null,
  label text,
  content text not null,
  page_start int,
  page_end int,
  char_count int,
  token_count int,
  embedding vector(1536),
  created_at timestamptz not null default now(),
  unique (source_id, chunk_index)
);

create index if not exists idx_source_chunks_source_id on public.source_chunks(source_id);
create index if not exists idx_source_chunks_embedding
  on public.source_chunks using hnsw (embedding vector_cosine_ops);

alter table public.source_chunks enable row level security;

create policy "Users manage source chunks via project"
  on public.source_chunks for all
  using (
    exists (
      select 1 from public.sources s
      join public.projects p on p.id = s.project_id
      where s.id = source_chunks.source_id and p.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.sources s
      join public.projects p on p.id = s.project_id
      where s.id = source_chunks.source_id and p.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Per-card source provenance. source_chunk_id is the structured link;
-- source_ref is a denormalized human label ("PDF::Page3") kept for display
-- even if the chunk row is later removed.
-- ---------------------------------------------------------------------------
alter table public.cards
  add column if not exists source_chunk_id uuid references public.source_chunks(id) on delete set null,
  add column if not exists source_ref text;

create index if not exists idx_cards_source_chunk_id on public.cards(source_chunk_id);

-- ---------------------------------------------------------------------------
-- browse_cards: surface source_ref so list rows can show a source hint.
-- Adding an OUT column changes the return type, so the old function must be
-- dropped before recreating it.
-- ---------------------------------------------------------------------------
drop function if exists public.browse_cards(uuid, uuid, text, text, int, int);

create or replace function public.browse_cards(
  p_user_id uuid,
  p_deck_id uuid default null,
  p_tag text default null,
  p_search text default null,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  id uuid,
  deck_id uuid,
  deck_name text,
  type text,
  front text,
  back text,
  cloze_text text,
  extra text,
  tags text[],
  sort_order int,
  user_edited boolean,
  suspended boolean,
  source_ref text,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with scoped as (
    select
      c.id,
      p.id as deck_id,
      coalesce(p.deck_name, p.name) as deck_name,
      c.type,
      c.front,
      c.back,
      c.cloze_text,
      c.extra,
      c.tags,
      c.sort_order,
      c.user_edited,
      coalesce(cr.suspended, false) as suspended,
      c.source_ref
    from public.cards c
    inner join public.generation_jobs gj on gj.id = c.job_id
    inner join public.sources s on s.id = gj.source_id
    inner join public.projects p on p.id = s.project_id
    left join lateral (
      select bool_or(cr2.suspended) as suspended
      from public.card_reviews cr2
      where cr2.card_id = c.id
        and cr2.user_id = p_user_id
    ) cr on true
    where p.user_id = p_user_id
      and (p_deck_id is null or p.id = p_deck_id)
      and (p_tag is null or p_tag = any(c.tags))
      and (
        p_search is null
        or btrim(p_search) = ''
        or coalesce(c.front, '') ilike '%' || p_search || '%'
        or coalesce(c.back, '') ilike '%' || p_search || '%'
        or coalesce(c.cloze_text, '') ilike '%' || p_search || '%'
        or coalesce(c.extra, '') ilike '%' || p_search || '%'
      )
  )
  select
    scoped.*,
    count(*) over() as total_count
  from scoped
  order by deck_name, sort_order, id
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
$$;

grant execute on function public.browse_cards(uuid, uuid, text, text, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Semantic retrieval over a user's source chunks (cosine distance).
-- ---------------------------------------------------------------------------
create or replace function public.match_source_chunks(
  p_query_embedding vector(1536),
  p_project_id uuid default null,
  p_source_id uuid default null,
  p_match_count int default 8
)
returns table (
  id uuid,
  source_id uuid,
  chunk_index int,
  source_ref text,
  label text,
  content text,
  page_start int,
  page_end int,
  similarity real
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select
    sc.id,
    sc.source_id,
    sc.chunk_index,
    sc.source_ref,
    sc.label,
    sc.content,
    sc.page_start,
    sc.page_end,
    (1 - (sc.embedding <=> p_query_embedding))::real as similarity
  from public.source_chunks sc
  join public.sources s on s.id = sc.source_id
  join public.projects p on p.id = s.project_id
  where p.user_id = auth.uid()
    and sc.embedding is not null
    and (p_project_id is null or p.id = p_project_id)
    and (p_source_id is null or sc.source_id = p_source_id)
  order by sc.embedding <=> p_query_embedding
  limit greatest(p_match_count, 1);
$$;

grant execute on function public.match_source_chunks(vector, uuid, uuid, int) to authenticated;
