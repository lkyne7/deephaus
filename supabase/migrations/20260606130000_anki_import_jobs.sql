-- Durable jobs for asynchronous Anki (.apkg) imports.
--
-- Large packages (multi-GB AnKing-style exports with review history) cannot be
-- processed inside a single serverless request: they blow past the /tmp size
-- cap, WASM memory ceiling, and the request timeout. Instead the client uploads
-- the package to storage, an enqueue route records a job here, and either the
-- web app (small packages, inline) or a standalone worker (large packages,
-- streaming) processes it out-of-band while the client polls for progress.

create table if not exists public.anki_import_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  storage_path text not null,
  filename text,
  file_size bigint,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'ready', 'failed')),
  phase text,
  progress integer not null default 0,
  scheduling boolean not null default true,
  deck_name_override text,
  result jsonb,
  error text,
  attempts integer not null default 0,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Worker polls for the oldest queued job; keep that lookup cheap.
create index if not exists anki_import_jobs_pending_idx
  on public.anki_import_jobs (created_at)
  where status = 'pending';

create index if not exists anki_import_jobs_user_idx
  on public.anki_import_jobs (user_id, created_at desc);

alter table public.anki_import_jobs enable row level security;

-- Users only ever see and manage their own import jobs. The worker connects
-- with the service-role key and bypasses RLS entirely.
create policy "Users read own anki import jobs"
  on public.anki_import_jobs
  for select
  using (auth.uid() = user_id);

create policy "Users create own anki import jobs"
  on public.anki_import_jobs
  for insert
  with check (auth.uid() = user_id);

create policy "Users update own anki import jobs"
  on public.anki_import_jobs
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Atomically claim the next queued job. SKIP LOCKED lets multiple worker
-- instances run safely without grabbing the same job. Returns null when the
-- queue is empty.
create or replace function public.claim_anki_import_job()
returns public.anki_import_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.anki_import_jobs;
begin
  select * into claimed
  from public.anki_import_jobs
  where status = 'pending'
  order by created_at
  for update skip locked
  limit 1;

  if claimed.id is null then
    return null;
  end if;

  update public.anki_import_jobs
  set status = 'processing',
      phase = 'starting',
      claimed_at = now(),
      updated_at = now(),
      attempts = attempts + 1
  where id = claimed.id
  returning * into claimed;

  return claimed;
end;
$$;

revoke all on function public.claim_anki_import_job() from public;
revoke all on function public.claim_anki_import_job() from anon;
revoke all on function public.claim_anki_import_job() from authenticated;
grant execute on function public.claim_anki_import_job() to service_role;
