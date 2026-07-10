-- Run against a migrated local database with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/cram_plan_isolation.sql
-- These assertions protect the structural isolation boundary even before
-- application-level review-flow tests run.

begin;

do $$
declare
  v_function text;
  v_table text;
  v_rls boolean;
begin
  select pg_get_functiondef(
    'public.record_cram_review(uuid,uuid,smallint,integer,jsonb,jsonb,integer)'::regprocedure
  ) into v_function;

  if v_function ilike '%card_reviews%' or v_function ilike '%review_logs%' then
    raise exception 'record_cram_review references normal scheduling tables';
  end if;

  foreach v_table in array array[
    'cram_plans',
    'cram_plan_deck_profiles',
    'cram_plan_items',
    'cram_review_logs'
  ]
  loop
    select c.relrowsecurity
    into v_rls
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = v_table;

    if v_rls is distinct from true then
      raise exception 'RLS is not enabled on public.%', v_table;
    end if;
  end loop;

  if exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal
      and n.nspname = 'public'
      and c.relname in ('card_reviews', 'review_logs')
      and pg_get_triggerdef(t.oid) ilike '%cram%'
  ) then
    raise exception 'Cram trigger found on normal scheduling tables';
  end if;
end;
$$;

rollback;
