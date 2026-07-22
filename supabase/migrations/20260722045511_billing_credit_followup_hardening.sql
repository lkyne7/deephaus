-- Billing/credit follow-up hardening.
--
-- The job tables intentionally retain their existing owner RLS policies, but
-- priority and credit linkage are derived/guarded here so an authenticated
-- owner cannot promote their own work or attach another credit transaction.

create index if not exists ai_credit_transactions_period_id_idx
  on public.ai_credit_transactions (period_id);
create index if not exists generation_jobs_credit_transaction_id_idx
  on public.generation_jobs (credit_transaction_id);
create index if not exists source_extraction_jobs_credit_transaction_id_idx
  on public.source_extraction_jobs (credit_transaction_id);

alter table public.source_extraction_jobs
  add column if not exists generation_status text
    check (generation_status in ('not_requested', 'pending', 'started', 'quota_exhausted', 'failed')),
  add column if not exists generation_error text;

create or replace function private.plan_queue_priority(target_user_id uuid)
returns smallint
language sql
stable
security definer
set search_path = ''
as $$
  select case when exists (
    select 1
    from public.billing_accounts ba
    where ba.user_id = target_user_id
      and ba.plan = 'pro'
      and ba.status in ('trialing', 'active', 'grace_period', 'billing_issue')
      and (ba.expires_at is null or ba.expires_at > now())
  ) then 1::smallint else 0::smallint end;
$$;

create or replace function private.request_database_role()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    current_user
  );
$$;

create or replace function private.guard_generation_job_billing_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid;
  linked_transaction_id uuid;
  request_role text := private.request_database_role();
begin
  select p.user_id
  into owner_id
  from public.sources s
  join public.projects p on p.id = s.project_id
  where s.id = new.source_id;

  if owner_id is null then
    raise exception 'GENERATION_JOB_OWNER_MISSING';
  end if;

  -- Queue priority is always database-derived. Plus is deliberately normal
  -- priority; only an active Pro account receives paid queue priority.
  new.plan_priority := private.plan_queue_priority(owner_id);

  if tg_op = 'INSERT' then
    select tx.id
    into linked_transaction_id
    from public.ai_credit_transactions tx
    where tx.user_id = owner_id
      and tx.resource_type = 'generation_job'
      and tx.resource_id = new.id
    order by tx.created_at
    limit 1;
    new.credit_transaction_id := linked_transaction_id;
  elsif new.credit_transaction_id is distinct from old.credit_transaction_id then
    if request_role <> 'service_role' then
      new.credit_transaction_id := old.credit_transaction_id;
    elsif new.credit_transaction_id is not null and not exists (
      select 1
      from public.ai_credit_transactions tx
      where tx.id = new.credit_transaction_id
        and tx.user_id = owner_id
        and tx.resource_type = 'generation_job'
        and tx.resource_id = new.id
    ) then
      raise exception 'GENERATION_JOB_CREDIT_TRANSACTION_MISMATCH';
    end if;
  end if;

  return new;
end;
$$;

create or replace function private.guard_source_extraction_job_billing_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid;
  linked_transaction_id uuid;
  request_role text := private.request_database_role();
begin
  select p.user_id
  into owner_id
  from public.sources s
  join public.projects p on p.id = s.project_id
  where s.id = new.source_id;

  if owner_id is null then
    raise exception 'SOURCE_EXTRACTION_JOB_OWNER_MISSING';
  end if;

  new.plan_priority := private.plan_queue_priority(owner_id);

  if tg_op = 'INSERT' then
    select tx.id
    into linked_transaction_id
    from public.ai_credit_transactions tx
    where tx.user_id = owner_id
      and tx.resource_type = 'source_extraction_job'
      and tx.resource_id = new.id
    order by tx.created_at
    limit 1;
    new.credit_transaction_id := linked_transaction_id;
  elsif new.credit_transaction_id is distinct from old.credit_transaction_id then
    if request_role <> 'service_role' then
      new.credit_transaction_id := old.credit_transaction_id;
    elsif new.credit_transaction_id is not null and not exists (
      select 1
      from public.ai_credit_transactions tx
      where tx.id = new.credit_transaction_id
        and tx.user_id = owner_id
        and tx.resource_type = 'source_extraction_job'
        and tx.resource_id = new.id
    ) then
      raise exception 'SOURCE_EXTRACTION_JOB_CREDIT_TRANSACTION_MISMATCH';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists generation_jobs_guard_billing_fields
  on public.generation_jobs;
create trigger generation_jobs_guard_billing_fields
  before insert or update of source_id, plan_priority, credit_transaction_id
  on public.generation_jobs
  for each row execute function private.guard_generation_job_billing_fields();

drop trigger if exists source_extraction_jobs_guard_billing_fields
  on public.source_extraction_jobs;
create trigger source_extraction_jobs_guard_billing_fields
  before insert or update of source_id, plan_priority, credit_transaction_id
  on public.source_extraction_jobs
  for each row execute function private.guard_source_extraction_job_billing_fields();

-- Normalize already queued rows using the same database-owned semantics.
update public.generation_jobs j
set plan_priority = private.plan_queue_priority(p.user_id)
from public.sources s
join public.projects p on p.id = s.project_id
where s.id = j.source_id;

update public.source_extraction_jobs j
set plan_priority = private.plan_queue_priority(p.user_id)
from public.sources s
join public.projects p on p.id = s.project_id
where s.id = j.source_id;

-- Rebase the current period whenever account access changes. If paid usage or
-- reservations already exceed Basic, allowance is temporarily pinned to the
-- consumed amount. Remaining is therefore zero and new reservations are
-- blocked without violating the period check constraint.
create or replace function private.rebase_current_credit_period()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  start_on date := date_trunc('month', now() at time zone 'UTC')::date;
  base_allowance integer;
begin
  base_allowance := private.plan_credit_allowance(new.user_id);

  update public.ai_credit_periods period
  set allowance = greatest(base_allowance, period.used + period.reserved),
      updated_at = now()
  where period.user_id = new.user_id
    and period.period_start = start_on;

  update public.generation_jobs job
  set plan_priority = private.plan_queue_priority(new.user_id)
  from public.sources source
  join public.projects project on project.id = source.project_id
  where source.id = job.source_id
    and project.user_id = new.user_id
    and job.status = 'pending';

  update public.source_extraction_jobs job
  set plan_priority = private.plan_queue_priority(new.user_id)
  from public.sources source
  join public.projects project on project.id = source.project_id
  where source.id = job.source_id
    and project.user_id = new.user_id
    and job.status = 'pending';

  return new;
end;
$$;

drop trigger if exists billing_accounts_rebase_credit_period
  on public.billing_accounts;
create trigger billing_accounts_rebase_credit_period
  after insert or update of plan, status, expires_at
  on public.billing_accounts
  for each row execute function private.rebase_current_credit_period();

create or replace function private.reserve_ai_credits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  start_on date := date_trunc('month', now() at time zone 'UTC')::date;
  finish_on date := (date_trunc('month', now() at time zone 'UTC') + interval '1 month')::date;
  current_allowance integer;
  current_period public.ai_credit_periods%rowtype;
begin
  if new.status <> 'reserved' or new.charged_credits <> 0 then
    raise exception 'AI_CREDIT_INVALID_RESERVATION';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(new.user_id::text || ':' || new.idempotency_key, 0)
  );
  if exists (
    select 1
    from public.ai_credit_transactions credit_tx
    where credit_tx.user_id = new.user_id
      and credit_tx.idempotency_key = new.idempotency_key
  ) then
    raise exception using
      errcode = '23505',
      message = 'AI_CREDIT_IDEMPOTENCY_CONFLICT';
  end if;

  current_allowance := private.plan_credit_allowance(new.user_id);

  insert into public.ai_credit_periods (
    user_id, period_start, period_end, allowance
  )
  values (
    new.user_id, start_on, finish_on, current_allowance
  )
  on conflict (user_id, period_start) do update
    set allowance = greatest(
          excluded.allowance,
          public.ai_credit_periods.used + public.ai_credit_periods.reserved
        ),
        updated_at = now();

  select *
  into current_period
  from public.ai_credit_periods
  where user_id = new.user_id and period_start = start_on
  for update;

  if current_period.used + current_period.reserved + new.reserved_credits >
     current_period.allowance then
    raise exception 'AI_CREDITS_EXHAUSTED:%:%:%',
      current_period.allowance,
      current_period.used + current_period.reserved,
      new.reserved_credits;
  end if;

  update public.ai_credit_periods
  set reserved = reserved + new.reserved_credits,
      updated_at = now()
  where id = current_period.id;

  new.period_id := current_period.id;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.reconcile_ai_credits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_period public.ai_credit_periods%rowtype;
begin
  if new.user_id <> old.user_id
     or new.period_id is distinct from old.period_id
     or new.idempotency_key <> old.idempotency_key
     or new.action <> old.action
     or new.reserved_credits <> old.reserved_credits then
    raise exception 'AI_CREDIT_IMMUTABLE_FIELDS';
  end if;

  if old.status in ('settled', 'released') then
    if new.status = old.status and new.charged_credits = old.charged_credits then
      return old;
    end if;
    raise exception 'AI_CREDIT_ALREADY_FINALIZED';
  end if;

  if new.status not in ('settled', 'released') then
    raise exception 'AI_CREDIT_INVALID_TRANSITION';
  end if;

  if new.status = 'settled' and new.charged_credits > old.reserved_credits then
    raise exception 'AI_CREDIT_CHARGE_EXCEEDS_RESERVATION:%:%',
      old.reserved_credits,
      new.charged_credits;
  end if;

  select *
  into current_period
  from public.ai_credit_periods
  where id = old.period_id
  for update;

  if not found then
    raise exception 'AI_CREDIT_PERIOD_MISSING';
  end if;

  if new.status = 'released' then
    new.charged_credits := 0;
    update public.ai_credit_periods
    set reserved = reserved - old.reserved_credits,
        updated_at = now()
    where id = current_period.id;
  else
    if current_period.used + current_period.reserved - old.reserved_credits +
       new.charged_credits > current_period.allowance then
      raise exception 'AI_CREDITS_EXHAUSTED:%:%:%',
        current_period.allowance,
        current_period.used + current_period.reserved - old.reserved_credits,
        new.charged_credits;
    end if;

    update public.ai_credit_periods
    set reserved = reserved - old.reserved_credits,
        used = used + new.charged_credits,
        updated_at = now()
    where id = current_period.id;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function private.plan_queue_priority(uuid) from public;
revoke execute on function private.request_database_role() from public;
revoke execute on function private.guard_generation_job_billing_fields() from public;
revoke execute on function private.guard_source_extraction_job_billing_fields() from public;
revoke execute on function private.rebase_current_credit_period() from public;
revoke execute on function private.reserve_ai_credits() from public;
revoke execute on function private.reconcile_ai_credits() from public;
