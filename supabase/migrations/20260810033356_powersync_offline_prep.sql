-- PowerSync offline-first prep.
--
-- 1. updated_at coverage for synced tables that were missing it.
-- 2. Explicit Data API grants for tables clients write directly (offline
--    upload queue writes via supabase-js under RLS, bypassing /api routes).
-- 3. Replication role + scoped publication for the PowerSync service.

-- ---------------------------------------------------------------------------
-- 1. updated_at + touch triggers
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

alter table public.sources
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists trg_sources_updated_at on public.sources;
create trigger trg_sources_updated_at
  before update on public.sources
  for each row execute function public.touch_updated_at();

alter table public.cram_plan_deck_profiles
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists trg_cram_plan_deck_profiles_updated_at on public.cram_plan_deck_profiles;
create trigger trg_cram_plan_deck_profiles_updated_at
  before update on public.cram_plan_deck_profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Data API grants for the synced table set
--
-- RLS policies already scope every one of these tables per user; these grants
-- make client access explicit so the app keeps working when Supabase enforces
-- "tables are not exposed by default" on existing projects.
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on
  public.projects,
  public.sources,
  public.generation_jobs,
  public.cards,
  public.card_reviews,
  public.review_logs,
  public.cram_plans,
  public.cram_plan_deck_profiles,
  public.cram_plan_items,
  public.cram_review_logs,
  public.user_study_settings,
  public.user_fsrs_params
to authenticated;

-- Profiles stay read-only from clients; mutations remain API-only.
grant select on public.user_profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 3. PowerSync replication role + publication
--
-- The role is created without a password. Set one out-of-band before
-- connecting the PowerSync instance:
--   alter role powersync_role with password '<strong-password>';
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'powersync_role') then
    create role powersync_role with replication bypassrls login;
  end if;
end
$$;

grant select on
  public.projects,
  public.sources,
  public.generation_jobs,
  public.cards,
  public.card_reviews,
  public.review_logs,
  public.cram_plans,
  public.cram_plan_deck_profiles,
  public.cram_plan_items,
  public.cram_review_logs,
  public.user_study_settings,
  public.user_fsrs_params,
  public.user_profiles
to powersync_role;

-- Scoped publication: billing, integration, and job-queue tables must not
-- replicate to the sync service.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'powersync') then
    create publication powersync for table
      public.projects,
      public.sources,
      public.generation_jobs,
      public.cards,
      public.card_reviews,
      public.review_logs,
      public.cram_plans,
      public.cram_plan_deck_profiles,
      public.cram_plan_items,
      public.cram_review_logs,
      public.user_study_settings,
      public.user_fsrs_params,
      public.user_profiles;
  end if;
end
$$;
