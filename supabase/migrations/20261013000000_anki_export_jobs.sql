-- Durable jobs for asynchronous Anki (.apkg) exports.
--
-- Building a package with media in a single request holds every image and the
-- finished zip in memory and returns it as one response body, which cannot
-- work for large decks on a serverless function. Instead an enqueue route
-- records a job here; the web app (small decks, inline) or the standalone
-- worker (large decks, streaming to scratch disk) builds the package into the
-- private apkg-exports bucket, and the client polls, then downloads it from a
-- signed URL with the browser's or OS's own download progress.

-- 11 GiB: an export of a 10 GiB (import-ceiling) deck is its media plus the
-- collection and zip overhead, so it must be allowed to exceed 10 GiB slightly.
insert into storage.buckets (id, name, public, file_size_limit)
values ('apkg-exports', 'apkg-exports', false, 11811160064)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;

-- Only the service role writes exports; users download through signed URLs
-- minted server-side, so no storage policies are granted to authenticated.

create table if not exists public.anki_export_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  generation_job_id uuid references public.generation_jobs (id) on delete cascade,
  include_progress boolean not null default true,
  filename text not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'ready', 'failed', 'expired')),
  phase text,
  progress integer not null default 0,
  storage_path text,
  file_size bigint,
  result jsonb,
  error text,
  attempts integer not null default 0,
  claimed_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists anki_export_jobs_pending_idx
  on public.anki_export_jobs (created_at)
  where status = 'pending';

create index if not exists anki_export_jobs_user_idx
  on public.anki_export_jobs (user_id, created_at desc);

-- The worker sweeps finished exports past their expiry.
create index if not exists anki_export_jobs_expiry_idx
  on public.anki_export_jobs (expires_at)
  where status = 'ready';

alter table public.anki_export_jobs enable row level security;

create policy "Users read own anki export jobs"
  on public.anki_export_jobs
  for select
  using (auth.uid() = user_id);

create policy "Users create own anki export jobs"
  on public.anki_export_jobs
  for insert
  with check (auth.uid() = user_id);

create policy "Users update own anki export jobs"
  on public.anki_export_jobs
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger prevent_deleted_account_writes
  before insert or update on public.anki_export_jobs
  for each row execute function private.prevent_deleted_account_writes();

-- Atomically claim the next queued export, mirroring claim_anki_import_job.
create or replace function public.claim_anki_export_job()
returns public.anki_export_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.anki_export_jobs;
begin
  select * into claimed
  from public.anki_export_jobs
  where status = 'pending'
  order by created_at
  for update skip locked
  limit 1;

  if claimed.id is null then
    return null;
  end if;

  update public.anki_export_jobs
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

revoke all on function public.claim_anki_export_job() from public;
revoke all on function public.claim_anki_export_job() from anon;
revoke all on function public.claim_anki_export_job() from authenticated;
grant execute on function public.claim_anki_export_job() to service_role;
