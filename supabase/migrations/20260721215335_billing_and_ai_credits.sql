-- Unified RevenueCat billing state and atomic monthly AI-credit accounting.
-- All tables are service-role only; clients consume normalized data through APIs.

create schema if not exists private;
revoke all on schema private from anon, authenticated, public;

create table public.billing_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan text not null default 'basic'
    check (plan in ('basic', 'plus', 'pro')),
  status text not null default 'inactive'
    check (status in ('inactive', 'trialing', 'active', 'grace_period', 'billing_issue', 'expired')),
  source text,
  product_id text,
  entitlement_ids text[] not null default '{}',
  expires_at timestamptz,
  will_renew boolean not null default false,
  environment text not null default 'production'
    check (environment in ('sandbox', 'production')),
  event_timestamp_ms bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.billing_events (
  event_id text primary key,
  user_id uuid references auth.users (id) on delete set null,
  event_type text not null,
  event_timestamp_ms bigint not null,
  environment text not null
    check (environment in ('sandbox', 'production')),
  processed_at timestamptz not null default now()
);

create table public.ai_credit_periods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  allowance integer not null check (allowance >= 0),
  used integer not null default 0 check (used >= 0),
  reserved integer not null default 0 check (reserved >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, period_start),
  check (period_end > period_start),
  check (used + reserved <= allowance)
);

create table public.ai_credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  period_id uuid references public.ai_credit_periods (id) on delete set null,
  idempotency_key text not null,
  action text not null,
  status text not null default 'reserved'
    check (status in ('reserved', 'settled', 'released')),
  reserved_credits integer not null check (reserved_credits > 0),
  charged_credits integer not null default 0 check (charged_credits >= 0),
  resource_type text,
  resource_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create index billing_events_user_idx
  on public.billing_events (user_id, processed_at desc);
create index ai_credit_periods_user_idx
  on public.ai_credit_periods (user_id, period_start desc);
create index ai_credit_transactions_user_idx
  on public.ai_credit_transactions (user_id, created_at desc);
create index ai_credit_transactions_resource_idx
  on public.ai_credit_transactions (resource_type, resource_id)
  where resource_id is not null;

alter table public.billing_accounts enable row level security;
alter table public.billing_events enable row level security;
alter table public.ai_credit_periods enable row level security;
alter table public.ai_credit_transactions enable row level security;

revoke all on public.billing_accounts from anon, authenticated;
revoke all on public.billing_events from anon, authenticated;
revoke all on public.ai_credit_periods from anon, authenticated;
revoke all on public.ai_credit_transactions from anon, authenticated;
grant all on public.billing_accounts to service_role;
grant all on public.billing_events to service_role;
grant all on public.ai_credit_periods to service_role;
grant all on public.ai_credit_transactions to service_role;

create or replace function private.plan_credit_allowance(target_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case coalesce((
    select ba.plan
    from public.billing_accounts ba
    where ba.user_id = target_user_id
      and ba.status in ('trialing', 'active', 'grace_period', 'billing_issue')
      and (ba.expires_at is null or ba.expires_at > now())
  ), 'basic')
    when 'pro' then 8000
    when 'plus' then 3000
    else 250
  end;
$$;

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

  -- Serialize equal idempotency keys before touching the period. Without this,
  -- a duplicate insert runs the BEFORE trigger before the unique constraint and
  -- can briefly reserve twice or return an unrelated exhaustion error.
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
    set allowance = greatest(public.ai_credit_periods.allowance, excluded.allowance),
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

revoke execute on function private.plan_credit_allowance(uuid) from public;
revoke execute on function private.reserve_ai_credits() from public;
revoke execute on function private.reconcile_ai_credits() from public;

create trigger ai_credit_transactions_reserve
  before insert on public.ai_credit_transactions
  for each row execute function private.reserve_ai_credits();

create trigger ai_credit_transactions_reconcile
  before update of status, charged_credits on public.ai_credit_transactions
  for each row execute function private.reconcile_ai_credits();

alter table public.generation_jobs
  add column credit_transaction_id uuid
    references public.ai_credit_transactions (id) on delete set null,
  add column plan_priority smallint not null default 0
    check (plan_priority between 0 and 2);

alter table public.source_extraction_jobs
  add column credit_transaction_id uuid
    references public.ai_credit_transactions (id) on delete set null,
  add column plan_priority smallint not null default 0
    check (plan_priority between 0 and 2);

drop index if exists public.source_extraction_jobs_pending_idx;
create index source_extraction_jobs_pending_idx
  on public.source_extraction_jobs (plan_priority desc, created_at)
  where status = 'pending';

create or replace function public.claim_source_extraction_job()
returns public.source_extraction_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.source_extraction_jobs;
begin
  select * into claimed
  from public.source_extraction_jobs
  where (
    status = 'pending'
    or (
      status = 'processing'
      and heartbeat_at < now() - interval '10 minutes'
      and attempts < 3
    )
  )
  order by
    case when created_at < now() - interval '10 minutes' then 3 else plan_priority end desc,
    created_at
  for update skip locked
  limit 1;

  if claimed.id is null then
    return null;
  end if;

  update public.source_extraction_jobs
  set status = 'processing',
      phase = 'starting',
      claimed_at = now(),
      heartbeat_at = now(),
      updated_at = now(),
      error = null,
      attempts = attempts + 1
  where id = claimed.id
  returning * into claimed;

  return claimed;
end;
$$;

revoke all on function public.claim_source_extraction_job() from public;
revoke all on function public.claim_source_extraction_job() from anon;
revoke all on function public.claim_source_extraction_job() from authenticated;
grant execute on function public.claim_source_extraction_job() to service_role;
