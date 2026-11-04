-- Individual, explicitly requested listing availability operations. No SQL
-- function sends an Eldorado request; server-only execution owns that boundary.
create table public.offer_availability_operations (
 id uuid primary key default gen_random_uuid(),
 actor_id uuid not null references public.users(id),
 actor_session_id uuid not null references public.employee_sessions(id),
 offer_id text not null references public.offers(id),
 source text not null check(source in ('flexible','predefined','items','currency')),
 native_id text not null check(native_id ~ '^[A-Za-z0-9_-]{1,150}$'),
 action text not null check(action in ('pause','resume')),
 reason text not null check(length(reason) between 10 and 1000),
 before_state text not null,
 observed_state text,
 status text not null default 'running' check(status in ('running','succeeded','failed','unknown','rejected')),
 expected_snapshot timestamptz not null,
 idempotency_key uuid not null,
 external_attempted boolean not null default false,
 error_code text check(error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{0,99}$'),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 finished_at timestamptz,
 unique(actor_id,idempotency_key)
);
-- Different source adapters may expose the same upstream listing. Serialize
-- by its native identifier so source aliases cannot bypass the write lock.
create unique index one_inflight_offer_availability
 on public.offer_availability_operations(native_id)
 where status in ('running','unknown');
create index offer_availability_actor_created
 on public.offer_availability_operations(actor_id,created_at desc);
alter table public.offer_availability_operations enable row level security;
revoke all on public.offer_availability_operations from public,anon,authenticated;
grant select on public.offer_availability_operations to authenticated;
grant all on public.offer_availability_operations to service_role;
create policy offer_availability_read on public.offer_availability_operations
 for select to authenticated using (
  public.has_permission('audit.read') or
  (actor_id=auth.uid() and public.has_permission('offers.read'))
 );

create function public.begin_offer_availability(
 offer_key text,
 desired_action text,
 expected_snapshot timestamptz,
 request_key uuid,
 justification text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
 listing public.offers;
 operation public.offer_availability_operations;
 expected_time timestamptz:=expected_snapshot;
 clean_reason text:=btrim(justification);
 sid uuid:=nullif(auth.jwt()->>'session_id','')::uuid;
 hits integer;
begin
 if not public.has_permission('offers.read') or not public.has_permission('offers.pause') then
  raise exception 'Offer availability permission required' using errcode='42501';
 end if;
 if desired_action not in ('pause','resume') or request_key is null or expected_time is null
    or clean_reason is null or length(clean_reason) not between 10 and 1000 then
  raise exception 'Invalid availability request' using errcode='22023';
 end if;
 -- Serialize every request for this listing, including concurrent retries.
 select * into listing from public.offers where id=offer_key for update;
 if not found then raise exception 'Offer not found' using errcode='P0002';end if;
 select * into operation from public.offer_availability_operations o
  where o.actor_id=auth.uid() and o.idempotency_key=request_key;
 if found then
  if operation.offer_id<>offer_key or operation.action<>desired_action
     or operation.reason<>clean_reason or operation.expected_snapshot<>expected_time then
   raise exception 'Idempotency key already used for a different request' using errcode='23505';
  end if;
  return jsonb_build_object('operation',to_jsonb(operation),'reused',true);
 end if;
 if listing.source not in ('flexible','predefined','items','currency')
    or listing.native_id is null or listing.native_id !~ '^[A-Za-z0-9_-]{1,150}$' then
  raise exception 'Offer source cannot be operated' using errcode='22023';
 end if;
 if listing.updated_at<>expected_time then
  raise exception 'Offer snapshot changed; synchronize and confirm again' using errcode='40001';
 end if;
 if exists(select 1 from public.offer_availability_operations o
           where o.native_id=listing.native_id and o.status in ('running','unknown')) then
  raise exception 'An operation for this offer needs reconciliation' using errcode='55000';
 end if;
 -- A direct RPC caller receives the same non-configurable rate limit as HTTP.
 insert into public.rate_limits(key) values(auth.uid()::text||':offers.availability')
 on conflict(key) do update set
  hits=case when rate_limits.window_start<now()-interval '60 seconds' then 1 else rate_limits.hits+1 end,
  window_start=case when rate_limits.window_start<now()-interval '60 seconds' then now() else rate_limits.window_start end
 returning rate_limits.hits into hits;
 if hits>10 then raise exception 'Offer availability rate limit reached' using errcode='P0001';end if;
 insert into public.offer_availability_operations(
  actor_id,actor_session_id,offer_id,source,native_id,action,reason,before_state,expected_snapshot,idempotency_key
 ) values(auth.uid(),sid,listing.id,listing.source,listing.native_id,desired_action,clean_reason,listing.state,expected_time,request_key)
 returning * into operation;
 insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
 values(auth.uid(),'offers.availability_requested','offer',listing.id,
        jsonb_build_object('operation_id',operation.id,'source',listing.source,'action',desired_action,'before_state',listing.state));
 return jsonb_build_object('operation',to_jsonb(operation),'reused',false);
end $$;

create function public.assert_offer_availability_execution(operation_id uuid)
 returns void language plpgsql security definer set search_path=public as $$
declare operation public.offer_availability_operations;
begin
 if not public.has_permission('offers.read') or not public.has_permission('offers.pause') then
  raise exception 'Offer availability permission required' using errcode='42501';
 end if;
 select * into operation from public.offer_availability_operations o where o.id=operation_id for update;
 if not found or operation.actor_id<>auth.uid()
    or operation.actor_session_id is distinct from nullif(auth.jwt()->>'session_id','')::uuid then
  raise exception 'Operation does not belong to this session' using errcode='42501';
 end if;
 if operation.status<>'running' or operation.external_attempted then
  raise exception 'Operation already claimed or no longer executable' using errcode='55000';
 end if;
 update public.offer_availability_operations set external_attempted=true,updated_at=now() where id=operation.id;
end $$;

create function public.finish_offer_availability(
 operation_id uuid,
 outcome text,
 observed text,
 failure_code text,
 snapshot jsonb default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare operation public.offer_availability_operations;
 target_state text;
begin
 select * into operation from public.offer_availability_operations o where o.id=operation_id for update;
 if not found then raise exception 'Operation not found' using errcode='P0002';end if;
 if outcome is null or outcome not in ('succeeded','failed','unknown','rejected')
    or (failure_code is not null and failure_code !~ '^[A-Z][A-Z0-9_]{0,99}$') then
  raise exception 'Invalid operation outcome' using errcode='22023';
 end if;
 if operation.status in ('succeeded','failed','rejected') then
  if operation.status=outcome then return to_jsonb(operation);end if;
  raise exception 'Operation already completed' using errcode='55000';
 end if;
 -- A timed-out request can arrive late upstream. An undesired observed state
 -- does not prove failure, so only observing the desired state clears unknown.
 if operation.status='unknown' and outcome not in ('unknown','succeeded') then
  raise exception 'Unknown upstream outcome must remain blocked until confirmed' using errcode='55000';
 end if;
 if outcome='failed' and operation.external_attempted then
  raise exception 'An attempted request needs a definitive rejection or reconciliation' using errcode='55000';
 end if;
 target_state:=case operation.action when 'pause' then 'paused' else 'active' end;
 if outcome='succeeded' and lower(coalesce(observed,''))<>target_state then
  raise exception 'Desired availability state has not been verified' using errcode='22023';
 end if;
 if snapshot is not null then
  if jsonb_typeof(snapshot)<>'object' or snapshot->>'id' is distinct from operation.offer_id
     or snapshot->>'source' is distinct from operation.source
     or snapshot->>'native_id' is distinct from operation.native_id
     or snapshot->>'state' is distinct from observed
     or coalesce(snapshot->>'title','')='' or coalesce(snapshot->>'category','')=''
     or snapshot->>'updated_at' is null then
   raise exception 'Verified offer snapshot does not match the operation' using errcode='22023';
  end if;
  update public.offers set
   state=snapshot->>'state',title=snapshot->>'title',category=snapshot->>'category',
   price=(snapshot->>'price')::numeric,currency=snapshot->>'currency',
   quantity=(snapshot->>'quantity')::numeric,game_id=snapshot->>'game_id',
   updated_at=(snapshot->>'updated_at')::timestamptz
   where id=operation.offer_id;
 end if;
 if outcome='succeeded' then
  -- The individual Seller API may verify only id/state. Preserve all existing
  -- commercial metadata while reflecting that verified state across aliases.
  update public.offers set state=observed,
   updated_at=case when snapshot is not null and id=operation.offer_id then updated_at else now() end
   where native_id=operation.native_id;
 end if;
 update public.offer_availability_operations set
  status=outcome,observed_state=observed,error_code=failure_code,updated_at=now(),
  finished_at=case when outcome in ('succeeded','failed','rejected') then now() else null end
  where id=operation.id returning * into operation;
 insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
 values(operation.actor_id,'offers.availability_finished','offer',operation.offer_id,
        jsonb_build_object('operation_id',operation.id,'source',operation.source,'action',operation.action,
                          'status',outcome,'observed_state',observed,'error_code',failure_code,
                          'upstream_attempted',operation.external_attempted));
 return to_jsonb(operation);
end $$;

revoke all on function public.begin_offer_availability(text,text,timestamptz,uuid,text) from public,anon,authenticated;
revoke all on function public.assert_offer_availability_execution(uuid) from public,anon,authenticated;
revoke all on function public.finish_offer_availability(uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.begin_offer_availability(text,text,timestamptz,uuid,text) to authenticated;
grant execute on function public.assert_offer_availability_execution(uuid) to authenticated;
grant execute on function public.finish_offer_availability(uuid,text,text,text,jsonb) to service_role;
