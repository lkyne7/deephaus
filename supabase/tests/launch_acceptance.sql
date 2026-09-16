-- Run only on the isolated launch staging branch. No fixtures survive rollback.
begin;
do $$
declare u uuid := gen_random_uuid(); b uuid := gen_random_uuid(); d uuid := gen_random_uuid();
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (u,'launch-'||u||'@example.test','{}'),(b,'launch-'||b||'@example.test','{}');
  insert into public.projects(id,user_id,name,deck_name) values(d,u,'Rollback fixture','Rollback fixture');
  insert into public.sources(id,project_id,type) values(d,d,'text');
  insert into public.generation_jobs(id,source_id) values(d,d);
  insert into public.cards(id,job_id,type,front,back) values(d,d,'basic','Fixture question','Fixture answer');
  insert into public.launch_feature_users values('review_reconciliation',u);
  perform set_config('launch.owner',u::text,true);
  perform set_config('launch.other',b::text,true);
  perform set_config('launch.card',d::text,true);
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('launch.other'),true);
select set_config('request.jwt.claim.role','authenticated',true);
do $$
begin
  if exists(select 1 from public.cards where id=current_setting('launch.card')::uuid) then raise exception 'Cross-account card leak'; end if;
  if exists(select 1 from public.launch_feature_users where user_id=current_setting('launch.owner')::uuid) then raise exception 'Cross-account rollout leak'; end if;
  if has_function_privilege(current_user,'public.consume_api_rate_limit(text,integer,integer)','EXECUTE') then raise exception 'Rate limiter is externally writable'; end if;
  begin
    insert into storage.objects(bucket_id,name) values('card-media',current_setting('launch.owner')||'/forged.png');
    raise exception 'Cross-account storage upload allowed';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claim.sub',current_setting('launch.owner'),true);
do $$
declare u uuid := current_setting('launch.owner')::uuid; c uuid := current_setting('launch.card')::uuid;
  early uuid := gen_random_uuid(); late uuid := gen_random_uuid(); n integer; mutation uuid;
  s jsonb; log jsonb; result jsonb;
begin
  if not exists(select 1 from public.cards where id=c) then raise exception 'Owner cannot read own card'; end if;
  foreach n in array array[2,1,2] loop
    mutation := case when n=2 then late else early end;
    s := jsonb_build_object('state',2,'stability',n,'difficulty',5,'elapsed_days',1,'scheduled_days',n,
      'reps',n,'lapses',0,'learning_steps',0,'last_review',now()-make_interval(mins=>3-n),'due',now()+interval '1 day');
    log := s || jsonb_build_object('rating',3,'review',s->>'last_review','last_elapsed_days',1,'next_state',s);
    result := public.apply_card_review(u,c,0::smallint,0,mutation,s,log,jsonb_build_object('next_state',s));
    if result->>'reconciliation' <> (case when n=1 then 'history_only' else 'authoritative' end) then raise exception 'Incorrect reconciliation: %',result; end if;
  end loop;
  if (select count(*) from public.review_events where target_id=c)<>2 then raise exception 'Lost or duplicated event'; end if;
  if (select count(*) from public.review_logs where card_id=c)<>2 then raise exception 'Lost or duplicated history'; end if;
  perform public.restore_card_review(c,0::smallint,early,true);
  if (select winning_review_id from public.card_reviews where card_id=c)<>late then raise exception 'Old undo replaced latest answer'; end if;
  if (select stability from public.card_reviews where card_id=c)<>2 then raise exception 'Schedule diverged'; end if;
  perform public.get_dashboard_metrics(u,now(),current_date::timestamptz,now()-interval '30 days',now()-interval '1 year');
end $$;

reset role;
insert into public.account_deletion_requests(user_id) values(current_setting('launch.owner')::uuid);
set local role authenticated;
do $$
begin
  begin
    update public.cards set front='Should be blocked' where id=current_setting('launch.card')::uuid;
    raise exception 'Deletion allowed a card write';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into storage.objects(bucket_id,name) values('card-media',current_setting('launch.owner')||'/late.png');
    raise exception 'Deletion allowed a storage write';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select 'PASS: ownership, storage, reconciliation, duplicate upload, undo, dashboard, deletion fences' as acceptance;
rollback;
