-- Run against a migrated local database with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/billing_credits.sql

begin;

do $$
declare
  target_user uuid := gen_random_uuid();
  transaction_id uuid;
  period_row public.ai_credit_periods%rowtype;
begin
  if pg_get_functiondef('private.reserve_ai_credits()'::regprocedure)
       not ilike '%for update%'
     or pg_get_functiondef('private.reserve_ai_credits()'::regprocedure)
       not ilike '%pg_advisory_xact_lock%' then
    raise exception 'Credit reservations must lock the period and idempotency key';
  end if;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'billing_accounts',
        'billing_events',
        'ai_credit_periods',
        'ai_credit_transactions'
      )
      and not c.relrowsecurity
  ) then
    raise exception 'Billing tables must have RLS enabled';
  end if;

  if has_table_privilege('authenticated', 'public.billing_accounts', 'select')
     or has_table_privilege('authenticated', 'public.ai_credit_periods', 'select')
     or has_table_privilege('authenticated', 'public.ai_credit_transactions', 'insert') then
    raise exception 'Authenticated clients must not access server-owned billing tables';
  end if;

  insert into auth.users (id, email)
  values (target_user, 'billing-test@example.com');

  insert into public.ai_credit_transactions (
    user_id, idempotency_key, action, reserved_credits
  )
  values (target_user, 'basic-reserve', 'generation', 200)
  returning id into transaction_id;

  begin
    insert into public.ai_credit_transactions (
      user_id, idempotency_key, action, reserved_credits
    )
    values (target_user, 'basic-reserve', 'generation', 200);
    raise exception 'Expected duplicate idempotency key to be rejected';
  exception
    when unique_violation then null;
  end;

  select *
  into period_row
  from public.ai_credit_periods
  where user_id = target_user;

  if period_row.allowance <> 250 or period_row.reserved <> 200 or period_row.used <> 0 then
    raise exception 'Unexpected Basic reservation state: %', row_to_json(period_row);
  end if;

  begin
    insert into public.ai_credit_transactions (
      user_id, idempotency_key, action, reserved_credits
    )
    values (target_user, 'over-limit', 'generation', 51);
    raise exception 'Expected Basic reservation to exceed allowance';
  exception
    when others then
      if sqlerrm not like 'AI_CREDITS_EXHAUSTED:%' then
        raise;
      end if;
  end;

  update public.ai_credit_transactions
  set status = 'settled', charged_credits = 100
  where id = transaction_id;

  select *
  into period_row
  from public.ai_credit_periods
  where user_id = target_user;

  if period_row.reserved <> 0 or period_row.used <> 100 then
    raise exception 'Settlement did not reconcile credits: %', row_to_json(period_row);
  end if;

  insert into public.billing_accounts (
    user_id, plan, status, entitlement_ids, expires_at, will_renew
  )
  values (
    target_user,
    'plus',
    'active',
    array['plus'],
    now() + interval '1 month',
    true
  );

  insert into public.ai_credit_transactions (
    user_id, idempotency_key, action, reserved_credits
  )
  values (target_user, 'plus-reserve', 'generation', 2800)
  returning id into transaction_id;

  select *
  into period_row
  from public.ai_credit_periods
  where user_id = target_user;

  if period_row.allowance <> 3000 or period_row.used <> 100 or period_row.reserved <> 2800 then
    raise exception 'Upgrade did not expand current allowance: %', row_to_json(period_row);
  end if;

  update public.ai_credit_transactions
  set status = 'released'
  where id = transaction_id;

  select *
  into period_row
  from public.ai_credit_periods
  where user_id = target_user;

  if period_row.reserved <> 0 or period_row.used <> 100 then
    raise exception 'Release did not return reserved credits: %', row_to_json(period_row);
  end if;

  insert into public.ai_credit_transactions (
    user_id, idempotency_key, action, reserved_credits
  )
  values (target_user, 'paid-before-downgrade', 'generation', 400)
  returning id into transaction_id;

  update public.ai_credit_transactions
  set status = 'settled', charged_credits = 400
  where id = transaction_id;

  update public.billing_accounts
  set plan = 'basic',
      status = 'expired',
      entitlement_ids = '{}',
      expires_at = now() - interval '1 minute',
      will_renew = false
  where user_id = target_user;

  select *
  into period_row
  from public.ai_credit_periods
  where user_id = target_user;

  if period_row.allowance <> 500
     or period_row.used <> 500
     or period_row.reserved <> 0 then
    raise exception 'Downgrade did not safely pin allowance to consumed credits: %',
      row_to_json(period_row);
  end if;

  begin
    insert into public.ai_credit_transactions (
      user_id, idempotency_key, action, reserved_credits
    )
    values (target_user, 'blocked-after-downgrade', 'generation', 1);
    raise exception 'Expected downgrade to block further reservations';
  exception
    when others then
      if sqlerrm not like 'AI_CREDITS_EXHAUSTED:%' then
        raise;
      end if;
  end;

  if private.plan_queue_priority(target_user) <> 0 then
    raise exception 'Expired accounts must not receive queue priority';
  end if;

  update public.billing_accounts
  set plan = 'plus',
      status = 'active',
      expires_at = now() + interval '1 month'
  where user_id = target_user;
  if private.plan_queue_priority(target_user) <> 0 then
    raise exception 'Plus must remain normal queue priority';
  end if;

  update public.billing_accounts
  set plan = 'pro'
  where user_id = target_user;
  if private.plan_queue_priority(target_user) <> 1 then
    raise exception 'Active Pro must receive paid queue priority';
  end if;

  if to_regclass('public.ai_credit_transactions_period_id_idx') is null
     or to_regclass('public.generation_jobs_credit_transaction_id_idx') is null
     or to_regclass('public.source_extraction_jobs_credit_transaction_id_idx') is null then
    raise exception 'Expected billing foreign-key indexes are missing';
  end if;
end;
$$;

rollback;
