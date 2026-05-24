-- Sluggo schema with row-level security

create extension if not exists "pgcrypto";

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  deck_name text not null,
  settings jsonb not null default '{"cardMix":"both","density":5}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  type text not null check (type in ('text', 'pdf')),
  raw_text text,
  storage_path text,
  page_count integer,
  created_at timestamptz not null default now()
);

create table if not exists public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','uploaded','extracting','chunking','generating','ready','failed')),
  error text,
  token_usage integer,
  progress integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.generation_jobs(id) on delete cascade,
  type text not null check (type in ('basic', 'cloze')),
  front text,
  back text,
  cloze_text text,
  extra text,
  tags text[] not null default '{}',
  sort_order integer not null default 0,
  user_edited boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_projects_user_id on public.projects(user_id);
create index if not exists idx_sources_project_id on public.sources(project_id);
create index if not exists idx_jobs_source_id on public.generation_jobs(source_id);
create index if not exists idx_cards_job_id on public.cards(job_id);

alter table public.projects enable row level security;
alter table public.sources enable row level security;
alter table public.generation_jobs enable row level security;
alter table public.cards enable row level security;

create policy "Users manage own projects"
  on public.projects for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage sources via project"
  on public.sources for all
  using (
    exists (
      select 1 from public.projects p
      where p.id = sources.project_id and p.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = sources.project_id and p.user_id = auth.uid()
    )
  );

create policy "Users manage jobs via source"
  on public.generation_jobs for all
  using (
    exists (
      select 1 from public.sources s
      join public.projects p on p.id = s.project_id
      where s.id = generation_jobs.source_id and p.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.sources s
      join public.projects p on p.id = s.project_id
      where s.id = generation_jobs.source_id and p.user_id = auth.uid()
    )
  );

create policy "Users manage cards via job"
  on public.cards for all
  using (
    exists (
      select 1 from public.generation_jobs j
      join public.sources s on s.id = j.source_id
      join public.projects p on p.id = s.project_id
      where j.id = cards.job_id and p.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.generation_jobs j
      join public.sources s on s.id = j.source_id
      join public.projects p on p.id = s.project_id
      where j.id = cards.job_id and p.user_id = auth.uid()
    )
  );

-- Storage bucket for PDF uploads (create via Supabase dashboard or CLI)
-- insert into storage.buckets (id, name, public) values ('pdfs', 'pdfs', false);
