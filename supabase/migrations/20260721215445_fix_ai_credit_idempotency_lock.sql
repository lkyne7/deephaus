-- Serialize reservations by idempotency key before the insert trigger mutates
-- the monthly period. This makes concurrent/retried inserts return a 23505
-- idempotency conflict without double-reserving or reporting false exhaustion.

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

revoke execute on function private.reserve_ai_credits() from public;
