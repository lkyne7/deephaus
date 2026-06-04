-- Exact card total for a user (avoids PostgREST 1000-row select limits on large libraries).

create or replace function public.count_user_cards(p_user_id uuid)
returns bigint
language sql
stable
security invoker
set search_path = public
as $$
  select count(c.id)::bigint
  from public.cards c
  inner join public.generation_jobs gj on gj.id = c.job_id
  inner join public.sources s on s.id = gj.source_id
  inner join public.projects p on p.id = s.project_id
  where p.user_id = p_user_id;
$$;

grant execute on function public.count_user_cards(uuid) to authenticated;
