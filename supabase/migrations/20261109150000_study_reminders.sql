-- Study reminders.
--
-- Nothing is scheduled ahead of time. A dispatcher asks, every few minutes and
-- per student, "what reminder is due right now?" from their current state
-- (@deephaus/scheduling, reminders.ts), so a session finished on another device
-- or an exam that moved is always taken into account. These tables hold only
-- what that needs: where to deliver, what the student allows, what was already
-- sent, and when each student is next worth looking at.

-- Where a student can be reached.
create table public.push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('web', 'desktop', 'ios')),
  -- web: the push endpoint URL. desktop: an id the app generated (the open app
  -- collects its reminders itself). ios: the device's push token.
  token text not null check (char_length(token) between 8 and 2048),
  -- web: the browser's PushSubscription keys.
  subscription jsonb,
  -- Shown in settings, e.g. "Chrome on macOS".
  label text check (char_length(label) <= 120),
  enabled boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One browser or device is one row, whoever is signed in on it.
  unique (platform, token)
);

create index push_devices_user_idx on public.push_devices (user_id);

alter table public.push_devices enable row level security;

create policy "Users manage own push devices"
  on public.push_devices for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger trg_push_devices_updated_at
  before update on public.push_devices
  for each row execute function public.touch_updated_at();

create trigger prevent_deleted_account_writes
  before insert or update on public.push_devices
  for each row execute function private.prevent_deleted_account_writes();

grant select, insert, update, delete on public.push_devices to authenticated;

-- What a student allows. No row means the defaults.
create table public.notification_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  exam_reminders boolean not null default true,
  daily_reviews boolean not null default true,
  -- Minutes after local midnight. Quiet hours may wrap past midnight.
  quiet_start smallint not null default 1320 check (quiet_start between 0 and 1439),
  quiet_end smallint not null default 480 check (quiet_end between 0 and 1439),
  daily_time smallint not null default 1140 check (daily_time between 0 and 1439),
  -- IANA zone the times above are read in, refreshed whenever a device
  -- registers. Null falls back to the study settings' zone.
  timezone text check (char_length(timezone) <= 100),
  updated_at timestamptz not null default now()
);

alter table public.notification_prefs enable row level security;

create policy "Users manage own notification prefs"
  on public.notification_prefs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger trg_notification_prefs_updated_at
  before update on public.notification_prefs
  for each row execute function public.touch_updated_at();

create trigger prevent_deleted_account_writes
  before insert or update on public.notification_prefs
  for each row execute function private.prevent_deleted_account_writes();

grant select, insert, update, delete on public.notification_prefs to authenticated;

-- Every reminder sent. It is how the same reminder is never sent twice, how
-- the daily cap is counted, how an ignored kind is sent less often, and what
-- the desktop app reads to show reminders while it is open.
create table public.notification_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null
    check (kind in ('warm_up', 'lock_in', 'next_pass', 'exam_session', 'behind', 'daily_reviews', 'test')),
  exam_id uuid references public.exams(id) on delete set null,
  -- Stable for one occasion, e.g. 'exam_session:<exam>:2026-11-09:1140'.
  dedupe_key text not null,
  title text not null,
  body text not null,
  -- App-relative path the reminder opens.
  path text not null,
  sent_at timestamptz not null default now(),
  -- Set when the student opened it.
  opened_at timestamptz,
  -- Set when the desktop app showed it.
  desktop_shown_at timestamptz,
  unique (user_id, dedupe_key)
);

create index notification_log_user_sent_idx on public.notification_log (user_id, sent_at desc);

alter table public.notification_log enable row level security;

-- Students can read their own log and mark a reminder opened or shown. Only
-- the dispatcher writes reminders.
create policy "Users read own notification log"
  on public.notification_log for select
  using (auth.uid() = user_id);

create policy "Users mark own notifications"
  on public.notification_log for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger prevent_deleted_account_writes
  before insert or update on public.notification_log
  for each row execute function private.prevent_deleted_account_writes();

-- Revoked first: projects created with Supabase's older defaults grant every
-- privilege on new tables, which would let a client rewrite a reminder.
revoke all on public.notification_log from anon, authenticated;
grant select on public.notification_log to authenticated;
grant update (opened_at, desktop_shown_at) on public.notification_log to authenticated;

-- When each student is next worth evaluating. Dispatcher only.
create table public.notification_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  next_check_at timestamptz not null default now(),
  checked_at timestamptz
);

alter table public.notification_state enable row level security;
revoke all on public.notification_state from anon, authenticated;

-- The dispatcher runs as the service role. Granted explicitly so it keeps
-- working where new tables are not exposed by default.
grant select, insert, update, delete on
  public.push_devices,
  public.notification_prefs,
  public.notification_log,
  public.notification_state
to service_role;

-- Students with a device to reach who are due a look, each marked as taken for
-- the next five minutes so two overlapping dispatch runs do not both evaluate
-- them. The dispatcher sets a better next time once it has looked.
create or replace function public.claim_reminder_checks(p_limit integer default 50)
returns setof uuid
language sql
security invoker
set search_path = public
as $$
  with due as (
    select d.user_id
    from (select distinct user_id from public.push_devices where enabled) d
    left join public.notification_state s on s.user_id = d.user_id
    left join public.notification_prefs p on p.user_id = d.user_id
    where coalesce(p.enabled, true)
      and (s.next_check_at is null or s.next_check_at <= now())
    order by s.next_check_at asc nulls first
    limit greatest(1, least(coalesce(p_limit, 50), 500))
  )
  insert into public.notification_state (user_id, next_check_at, checked_at)
  select user_id, now() + interval '5 minutes', now() from due
  on conflict (user_id) do update
    set next_check_at = excluded.next_check_at, checked_at = excluded.checked_at
  returning user_id;
$$;

revoke all on function public.claim_reminder_checks(integer) from public, anon, authenticated;
grant execute on function public.claim_reminder_checks(integer) to service_role;

notify pgrst, 'reload schema';
