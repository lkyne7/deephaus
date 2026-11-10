-- Community listing fields, and card identity so an update keeps a learner's progress.
--
-- Additive only. Existing rows keep working: a null subject is "no subject",
-- and a subscription with no card links is linked by content on its next update.

-- A listing's subject, and when its cards last changed. `updated_at` also moves
-- when someone adds or rates the deck, so it can't say when the content changed.
alter table public.deck_publications
  add column if not exists subject text,
  add column if not exists content_updated_at timestamptz;

update public.deck_publications
set content_updated_at = case when version > 1 then updated_at else published_at end
where content_updated_at is null;

alter table public.deck_publications
  alter column content_updated_at set default now(),
  alter column content_updated_at set not null;

alter table public.deck_publications
  drop constraint if exists deck_publications_subject_length;
alter table public.deck_publications
  add constraint deck_publications_subject_length
  check (subject is null or char_length(subject) between 1 and 40);

create index if not exists idx_deck_publications_subject on public.deck_publications(subject);

-- The publisher's own card behind each published card. It stays the same across
-- republishes, which rewrite every publication_cards row.
alter table public.publication_cards
  add column if not exists source_card_id uuid;

create index if not exists idx_publication_cards_source
  on public.publication_cards(publication_id, source_card_id);

-- Which of a learner's cards came from which published card. With this an
-- update can change a card in place instead of deleting it and its reviews.
create table if not exists public.deck_subscription_cards (
  subscription_id uuid not null references public.deck_subscriptions(id) on delete cascade,
  source_card_id uuid not null,
  local_card_id uuid not null references public.cards(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (subscription_id, source_card_id),
  unique (local_card_id)
);

alter table public.deck_subscription_cards enable row level security;

drop policy if exists "Subscribers manage their card links" on public.deck_subscription_cards;
create policy "Subscribers manage their card links"
  on public.deck_subscription_cards for all
  using (
    exists (
      select 1 from public.deck_subscriptions s
      where s.id = deck_subscription_cards.subscription_id and s.subscriber_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.deck_subscriptions s
      where s.id = deck_subscription_cards.subscription_id and s.subscriber_id = auth.uid()
    )
  );

-- What a published deck holds: cards per type and its most used tags. Runs as
-- the caller, so the existing "signed-in users read publication cards" policy applies.
create or replace function public.publication_card_facts(
  p_publication_id uuid,
  p_tag_limit integer default 6
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'types', coalesce((
      select jsonb_object_agg(t.type, t.n)
      from (
        select c.type, count(*)::integer as n
        from public.publication_cards c
        where c.publication_id = p_publication_id
        group by c.type
      ) t
    ), '{}'::jsonb),
    'tags', coalesce((
      select jsonb_agg(t.tag order by t.n desc, t.tag)
      from (
        select tag, count(*) as n
        from public.publication_cards c
        cross join lateral unnest(c.tags) as tag
        where c.publication_id = p_publication_id
        group by tag
        order by count(*) desc, tag
        limit greatest(p_tag_limit, 0)
      ) t
    ), '[]'::jsonb)
  );
$$;

-- Publisher usernames for the listing. Profiles are readable by their owner
-- only, so this is run by the server with the service role and returns the
-- username and nothing else, as the leaderboard does.
create or replace function public.get_publication_authors(p_publisher_ids uuid[])
returns table (user_id uuid, username text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.user_id, p.username
  from public.user_profiles p
  where p.user_id = any(p_publisher_ids);
$$;

revoke execute on function public.get_publication_authors(uuid[])
  from anon, authenticated, public;
grant execute on function public.get_publication_authors(uuid[]) to service_role;
