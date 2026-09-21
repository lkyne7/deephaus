-- Additive rollout: apply before the web deployment. Existing OAuth grants have
-- no audience and must reconnect after deployment; personal tokens are unchanged.
alter table public.oauth_codes add column if not exists resource text;
alter table public.oauth_refresh_tokens add column if not exists resource text;
alter table public.api_tokens add column if not exists resource text;

-- These functions are service-only and run with the caller's privileges. The
-- shared transaction lock serializes refresh replay, rotation and revocation.
create or replace function public.revoke_oauth_grant(p_user_id uuid, p_client_id text)
returns void language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_client_id, 0));
  update public.oauth_refresh_tokens set revoked_at = now()
    where user_id = p_user_id and client_id = p_client_id and revoked_at is null;
  update public.api_tokens set revoked_at = now()
    where user_id = p_user_id and client_id = p_client_id and kind = 'oauth' and revoked_at is null;
end;
$$;
revoke all on function public.revoke_oauth_grant(uuid, text) from public, anon, authenticated;
grant execute on function public.revoke_oauth_grant(uuid, text) to service_role;

create or replace function public.rotate_oauth_refresh_token(
  p_token_hash text, p_client_id text, p_resource text, p_scopes text[],
  p_access_hash text, p_access_prefix text, p_refresh_hash text
)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  old_token public.oauth_refresh_tokens%rowtype;
  next_scopes text[];
  next_access_id uuid;
begin
  select * into old_token from public.oauth_refresh_tokens where token_hash = p_token_hash;
  if not found or p_client_id is null or old_token.client_id <> p_client_id then
    return jsonb_build_object('ok', false, 'error', 'invalid_grant', 'description', 'Unknown refresh token or client.');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(old_token.user_id::text || ':' || p_client_id, 0));
  select * into old_token from public.oauth_refresh_tokens where token_hash = p_token_hash for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_grant', 'description', 'Unknown refresh token.');
  end if;
  if old_token.resource is null or p_resource is null or old_token.resource <> p_resource then
    return jsonb_build_object('ok', false, 'error', 'invalid_grant', 'description', 'Refresh token is not bound to this resource. Please reconnect.');
  end if;
  if old_token.revoked_at is not null then
    perform public.revoke_oauth_grant(old_token.user_id, p_client_id);
    return jsonb_build_object('ok', false, 'error', 'invalid_grant', 'description', 'Refresh token has been revoked.');
  end if;
  if old_token.expires_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'invalid_grant', 'description', 'Refresh token has expired.');
  end if;
  next_scopes := coalesce(p_scopes, old_token.scopes);
  if cardinality(next_scopes) = 0 or array_position(next_scopes, null) is not null or not next_scopes <@ old_token.scopes then
    return jsonb_build_object('ok', false, 'error', 'invalid_scope', 'description', 'Refresh scope must be a non-empty subset of the original grant.');
  end if;

  insert into public.api_tokens(user_id, name, token_prefix, token_hash, scopes, kind, client_id, resource, expires_at)
    values(old_token.user_id, old_token.client_name, p_access_prefix, p_access_hash, next_scopes,
      'oauth', p_client_id, p_resource, now() + interval '1 hour') returning id into next_access_id;
  insert into public.oauth_refresh_tokens(token_hash, user_id, client_id, client_name, scopes, api_token_id, resource, expires_at)
    values(p_refresh_hash, old_token.user_id, p_client_id, old_token.client_name, next_scopes,
      next_access_id, p_resource, now() + interval '90 days');
  update public.oauth_refresh_tokens set revoked_at = now() where id = old_token.id;
  update public.api_tokens set revoked_at = now() where id = old_token.api_token_id;
  return jsonb_build_object('ok', true, 'scopes', next_scopes);
end;
$$;
revoke all on function public.rotate_oauth_refresh_token(text, text, text, text[], text, text, text) from public, anon, authenticated;
grant execute on function public.rotate_oauth_refresh_token(text, text, text, text[], text, text, text) to service_role;
