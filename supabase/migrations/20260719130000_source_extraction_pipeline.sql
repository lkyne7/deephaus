-- Durable, page-aware PDF extraction jobs for the hybrid pdfjs/Mistral worker.

create table if not exists public.source_extraction_jobs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources (id) on delete cascade,
  storage_path text not null,
  filename text not null,
  file_size bigint,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'ready', 'failed')),
  phase text not null default 'queued',
  progress integer not null default 0 check (progress between 0 and 100),
  pages_total integer,
  pages_completed integer not null default 0,
  extractor_version text,
  quality_score real,
  requested_generation jsonb,
  generation_job_id uuid references public.generation_jobs (id) on delete set null,
  extract_images boolean not null default true,
  error text,
  attempts integer not null default 0,
  claimed_at timestamptz,
  heartbeat_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.source_extraction_pages (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.source_extraction_jobs (id) on delete cascade,
  source_id uuid not null references public.sources (id) on delete cascade,
  page_number integer not null check (page_number > 0),
  extractor text not null,
  extractor_version text not null,
  route text not null check (route in ('local', 'ocr', 'fallback')),
  quality_score real,
  inspection jsonb,
  normalized_blocks jsonb not null default '[]'::jsonb,
  markdown text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, page_number)
);

create index if not exists source_extraction_jobs_pending_idx
  on public.source_extraction_jobs (created_at)
  where status = 'pending';
create index if not exists source_extraction_jobs_source_idx
  on public.source_extraction_jobs (source_id, created_at desc);
create index if not exists source_extraction_pages_source_idx
  on public.source_extraction_pages (source_id, page_number);

alter table public.source_extraction_jobs enable row level security;
alter table public.source_extraction_pages enable row level security;

create policy "Users manage extraction jobs through projects"
  on public.source_extraction_jobs for all
  using (
    exists (
      select 1 from public.sources s
      join public.projects p on p.id = s.project_id
      where s.id = source_extraction_jobs.source_id and p.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.sources s
      join public.projects p on p.id = s.project_id
      where s.id = source_extraction_jobs.source_id and p.user_id = auth.uid()
    )
  );

create policy "Users read extraction pages through projects"
  on public.source_extraction_pages for select
  using (
    exists (
      select 1 from public.sources s
      join public.projects p on p.id = s.project_id
      where s.id = source_extraction_pages.source_id and p.user_id = auth.uid()
    )
  );

-- Claim pending jobs, or reclaim abandoned jobs whose heartbeat expired. The
-- attempt cap prevents a permanently bad document from looping forever.
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
  order by created_at
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

-- Private, user-scoped direct uploads. TUS object names always begin with the
-- authenticated user's UUID.
insert into storage.buckets (id, name, public, file_size_limit)
values ('pdfs', 'pdfs', false, 1073741824)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;

create policy "Users read own source uploads"
  on storage.objects for select to authenticated
  using (bucket_id = 'pdfs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users create own source uploads"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'pdfs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users update own source uploads"
  on storage.objects for update to authenticated
  using (bucket_id = 'pdfs' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'pdfs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users delete own source uploads"
  on storage.objects for delete to authenticated
  using (bucket_id = 'pdfs' and (storage.foldername(name))[1] = auth.uid()::text);
