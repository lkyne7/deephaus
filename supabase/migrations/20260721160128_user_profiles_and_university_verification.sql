create schema if not exists private;
revoke all on schema private from anon, authenticated, public;

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  full_name text not null default '',
  university_name text,
  university_domain text,
  university_email text,
  university_email_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_profiles_username_format
    check (username = lower(username) and username ~ '^[a-z0-9_]{3,30}$'),
  constraint user_profiles_full_name_length check (char_length(full_name) <= 80),
  constraint user_profiles_university_verification_consistent check (
    university_email_verified_at is null
    or (
      university_name is not null
      and university_domain is not null
      and university_email is not null
    )
  )
);

create unique index if not exists user_profiles_username_lower_unique
  on public.user_profiles (lower(username));

alter table public.user_profiles enable row level security;

drop policy if exists "Users read own profile" on public.user_profiles;
create policy "Users read own profile"
  on public.user_profiles for select
  using (auth.uid() = user_id);

-- Profile mutations go through the session-authenticated API so verification
-- state cannot be forged with the public Data API.
revoke insert, update, delete on public.user_profiles from anon, authenticated;
grant select on public.user_profiles to authenticated;

create table if not exists public.university_email_verifications (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  university_name text not null,
  university_domain text not null,
  code_hash text not null,
  attempts integer not null default 0,
  sent_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint university_email_verifications_attempts_nonnegative check (attempts >= 0)
);

alter table public.university_email_verifications enable row level security;
revoke all on public.university_email_verifications from anon, authenticated;

create or replace function public.complete_university_email_verification(
  target_user_id uuid,
  target_email text,
  submitted_code_hash text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  challenge public.university_email_verifications%rowtype;
begin
  select *
  into challenge
  from public.university_email_verifications
  where user_id = target_user_id
  for update;

  if not found then return 'missing'; end if;
  if lower(challenge.email) <> lower(target_email) then return 'email_mismatch'; end if;
  if challenge.expires_at <= now() then
    delete from public.university_email_verifications where user_id = target_user_id;
    return 'expired';
  end if;
  if challenge.attempts >= 5 then return 'locked'; end if;
  if challenge.code_hash <> submitted_code_hash then
    update public.university_email_verifications
    set attempts = attempts + 1
    where user_id = target_user_id;
    return 'invalid';
  end if;

  update public.user_profiles
  set university_name = challenge.university_name,
      university_domain = challenge.university_domain,
      university_email = lower(challenge.email),
      university_email_verified_at = now()
  where user_id = target_user_id;

  delete from public.university_email_verifications where user_id = target_user_id;
  return 'verified';
end;
$$;

revoke execute on function public.complete_university_email_verification(uuid, text, text)
  from anon, authenticated, public;

create or replace function private.profile_username_base(source text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    nullif(
      trim(both '_' from regexp_replace(lower(coalesce(source, '')), '[^a-z0-9]+', '_', 'g')),
      ''
    ),
    'learner'
  );
$$;

create or replace function private.create_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_username text;
  generated_username text;
  profile_name text;
begin
  profile_name := coalesce(
    nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'name'), ''),
    ''
  );
  base_username := left(
    private.profile_username_base(
      coalesce(
        nullif(new.raw_user_meta_data->>'preferred_username', ''),
        nullif(new.raw_user_meta_data->>'user_name', ''),
        split_part(coalesce(new.email, ''), '@', 1)
      )
    ),
    21
  );
  if char_length(base_username) < 3 then
    base_username := rpad(base_username, 3, '_');
  end if;
  generated_username := base_username || '_' || left(replace(new.id::text, '-', ''), 8);

  insert into public.user_profiles (user_id, username, full_name)
  values (new.id, generated_username, left(profile_name, 80))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke execute on function private.profile_username_base(text) from public;
revoke execute on function private.create_user_profile() from public;

drop trigger if exists create_user_profile_after_auth_user on auth.users;
create trigger create_user_profile_after_auth_user
  after insert on auth.users
  for each row execute function private.create_user_profile();

insert into public.user_profiles (user_id, username, full_name)
select
  u.id,
  (
    case
      when char_length(private.profile_username_base(split_part(coalesce(u.email, ''), '@', 1))) < 3
        then rpad(private.profile_username_base(split_part(coalesce(u.email, ''), '@', 1)), 3, '_')
      else left(private.profile_username_base(split_part(coalesce(u.email, ''), '@', 1)), 21)
    end
    || '_' || left(replace(u.id::text, '-', ''), 8)
  ),
  left(
    coalesce(
      nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
      nullif(trim(u.raw_user_meta_data->>'name'), ''),
      ''
    ),
    80
  )
from auth.users u
on conflict (user_id) do nothing;

create or replace function private.touch_user_profile()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function private.touch_user_profile() from public;

drop trigger if exists touch_user_profiles_updated_at on public.user_profiles;
create trigger touch_user_profiles_updated_at
  before update on public.user_profiles
  for each row execute function private.touch_user_profile();
