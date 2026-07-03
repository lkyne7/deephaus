-- Pending migrations for project rdfijwmxlyvykcnxfurd (DeepHaus).
-- Run in Supabase Dashboard → SQL Editor if `supabase db push` is unavailable.
-- Safe to re-run: uses IF NOT EXISTS / OR REPLACE where possible.

-- 20260703150000_source_extract_images.sql
alter table public.sources
  add column if not exists extract_images boolean not null default true;

-- 20260703160000_api_tokens.sql
create table if not exists public.api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  token_prefix text not null,
  token_hash text not null unique,
  scopes text[] not null default array['study']::text[],
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists idx_api_tokens_user_id on public.api_tokens(user_id);
create index if not exists idx_api_tokens_hash_active
  on public.api_tokens(token_hash)
  where revoked_at is null;

alter table public.api_tokens enable row level security;

-- 20260703160000_browse_cards_occlusion.sql
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
  source_quote text,
  occlusion_data jsonb,
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
      c.source_ref,
      c.source_quote,
      c.occlusion_data
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
