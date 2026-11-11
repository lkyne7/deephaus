-- The Render workers have no HTTP port to probe, so each one records a
-- heartbeat here once a minute and GET /api/health reports a worker whose
-- heartbeat has gone stale. Only the service role can read or write it.
create table private.worker_heartbeats (
  worker text primary key check (length(worker) between 1 and 64),
  seen_at timestamptz not null default now()
);

create or replace function public.record_worker_heartbeat(p_worker text) returns void
language sql security definer set search_path = '' as $$
  insert into private.worker_heartbeats as h (worker, seen_at)
  values (p_worker, now())
  on conflict (worker) do update set seen_at = excluded.seen_at;
$$;
revoke all on function public.record_worker_heartbeat(text) from public, anon, authenticated;
grant execute on function public.record_worker_heartbeat(text) to service_role;

create or replace function public.worker_heartbeats() returns table (worker text, seen_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select h.worker, h.seen_at from private.worker_heartbeats h;
$$;
revoke all on function public.worker_heartbeats() from public, anon, authenticated;
grant execute on function public.worker_heartbeats() to service_role;
