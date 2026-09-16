-- Durable cleanup records intentionally survive deletion of the auth user.
create table public.account_deletion_requests (
  user_id uuid primary key,
  status text not null default 'pending' check (status in ('pending','processing','complete')),
  attempts integer not null default 0,
  requested_at timestamptz not null default now(),
  lease_until timestamptz,
  last_error text
);
alter table public.account_deletion_requests enable row level security;
revoke all on public.account_deletion_requests from anon, authenticated;
grant select on public.account_deletion_requests to authenticated;
create policy "Read own deletion status" on public.account_deletion_requests for select to authenticated using (user_id = (select auth.uid()));
grant all on public.account_deletion_requests to service_role;

create or replace function private.prevent_deleted_account_writes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare owner_id uuid;
begin
  if tg_table_schema = 'storage' then
    begin owner_id := split_part(new.name, '/', 1)::uuid; exception when invalid_text_representation then return new; end;
  else
    owner_id := nullif(to_jsonb(new)->>'user_id','')::uuid;
    if owner_id is null and to_jsonb(new)->>'job_id' is not null then
      select s.user_id into owner_id from public.generation_jobs g join public.sources s on s.id=g.source_id where g.id=(to_jsonb(new)->>'job_id')::uuid;
    end if;
    if owner_id is null and to_jsonb(new)->>'source_id' is not null then
      select s.user_id into owner_id from public.sources s where s.id=(to_jsonb(new)->>'source_id')::uuid;
    end if;
    if owner_id is null and to_jsonb(new)->>'plan_id' is not null then
      select p.user_id into owner_id from public.cram_plans p where p.id=(to_jsonb(new)->>'plan_id')::uuid;
    end if;
    if owner_id is null and to_jsonb(new)->>'project_id' is not null then
      select p.user_id into owner_id from public.projects p where p.id=(to_jsonb(new)->>'project_id')::uuid;
    end if;
    if owner_id is null then owner_id := auth.uid(); end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('account-deletion:'||owner_id::text,0));
  if exists (select 1 from public.account_deletion_requests d where d.user_id = owner_id) then
    raise exception 'Account deletion is in progress' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.prevent_deleted_account_writes() from public;
do $$ declare t record; begin
  for t in select distinct c.table_name from information_schema.columns c join information_schema.tables tbl using(table_schema,table_name) where c.table_schema='public' and tbl.table_type='BASE TABLE' and c.column_name in ('user_id','source_id','job_id','plan_id','project_id') and c.table_name <> 'account_deletion_requests' loop
    execute format('create trigger prevent_deleted_account_writes before insert or update on public.%I for each row execute function private.prevent_deleted_account_writes()', t.table_name);
  end loop;
end $$;
create trigger prevent_deleted_account_storage before insert or update on storage.objects for each row execute function private.prevent_deleted_account_writes();

create or replace function public.claim_account_deletion() returns setof public.account_deletion_requests
language sql security invoker set search_path = public as $$
  update public.account_deletion_requests set status='processing', attempts=attempts+1, lease_until=now()+interval '2 minutes'
  where user_id = (select user_id from public.account_deletion_requests where status <> 'complete' and (lease_until is null or lease_until < now()) order by requested_at for update skip locked limit 1)
  returning *;
$$;
revoke all on function public.claim_account_deletion() from public, anon, authenticated;
grant execute on function public.claim_account_deletion() to service_role;

create table private.api_rate_windows (key text primary key, count integer not null, expires_at timestamptz not null);
create or replace function public.consume_api_rate_limit(p_key text, p_limit integer, p_window_seconds integer default 60) returns boolean
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if p_limit < 1 or p_window_seconds < 1 or length(p_key) > 200 then raise exception 'Invalid rate limit'; end if;
  insert into private.api_rate_windows as w values(p_key, 1, clock_timestamp()+make_interval(secs=>p_window_seconds))
  on conflict(key) do update set count=case when w.expires_at <= clock_timestamp() then 1 else w.count+1 end,
    expires_at=case when w.expires_at <= clock_timestamp() then clock_timestamp()+make_interval(secs=>p_window_seconds) else w.expires_at end
  returning count into n;
  delete from private.api_rate_windows where expires_at < now()-interval '1 hour';
  return n <= p_limit;
end $$;
revoke all on function public.consume_api_rate_limit(text,integer,integer) from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(text,integer,integer) to service_role;

-- Fence the deletion request against writes already in flight. Cleanup cannot
-- observe an empty prefix while an older upload transaction is still committing.
create or replace function private.fence_account_deletion() returns trigger
language plpgsql set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('account-deletion:'||new.user_id::text,0));
  return new;
end $$;
revoke all on function private.fence_account_deletion() from public;
create trigger fence_account_deletion before insert on public.account_deletion_requests for each row execute function private.fence_account_deletion();
