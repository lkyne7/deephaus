-- Deleting an account deletes the auth user while its deletion request is
-- still pending, and the cascade from auth.users runs ON DELETE SET NULL
-- actions (an exam's review_logs.exam_id, a credit period's transactions)
-- as UPDATEs. The write fence refused those UPDATEs whenever the parent was
-- cascaded first, so deletion failed for accounts with exams or credit
-- history. Updates issued by a foreign-key action run one trigger level
-- down; the fence now lets those through. Direct writes and inserts made by
-- other triggers are still refused.
create or replace function private.prevent_deleted_account_writes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare owner_id uuid;
begin
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 then
    return new;
  end if;
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
