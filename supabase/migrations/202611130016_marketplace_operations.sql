-- Reuse immutable, independently reviewed approvals for documented API writes.
create or replace function public.consume_rate_limit(bucket text,max_hits integer,window_seconds integer)
 returns boolean language plpgsql security definer set search_path=public as $$
declare result integer;
begin
 if not public.staff_active() then raise exception 'Access denied' using errcode='42501';end if;
 if bucket not in ('orders.sync','team.invite','operations.write','integration.connect','integration.health',
  'marketplace.request','marketplace.execute','marketplace.comparison') then raise exception 'Invalid bucket';end if;
 -- Application throttles, not claimed Eldorado API quotas. Callers cannot
 -- loosen them by supplying a different max_hits/window_seconds.
 max_hits:=case bucket when 'orders.sync' then 20 when 'operations.write' then 30
  when 'integration.connect' then 3 when 'integration.health' then 3 else 10 end;
 window_seconds:=60;
 insert into public.rate_limits(key) values(auth.uid()::text||':'||bucket) on conflict(key) do update set
  hits=case when rate_limits.window_start<now()-make_interval(secs=>window_seconds) then 1 else rate_limits.hits+1 end,
  window_start=case when rate_limits.window_start<now()-make_interval(secs=>window_seconds) then now() else rate_limits.window_start end returning hits into result;
 return result<=max_hits;
end $$;
alter table public.approval_requests drop constraint approval_requests_action_check;
alter table public.approval_requests add constraint approval_requests_action_check check(action in
 ('orders.deliver','orders.cancel','orders.update_delivery','offers.delete','offers.update_price',
  'offers.update_stock','offers.create','inventory.manage','team.manage_permissions'));
alter table public.approval_requests add column external_attempted boolean not null default false;

-- Serialize by upstream identity across pause/resume and reviewed edits,
-- including aliases returned by different catalog adapters.
create function public.guard_marketplace_lock() returns trigger language plpgsql security definer set search_path=public as $$
declare lock_name text;
begin
 if tg_table_name='offer_availability_operations' then
  if new.status not in ('running','unknown') then return new;end if;
  lock_name:='offer:'||lower(new.native_id);
 else
  if new.payload->>'marketV1' is distinct from 'true' or new.status not in ('pending','approved','executing','blocked') then return new;end if;
  if new.status='approved' and auth.jwt()->>'aal' is distinct from 'aal2' then raise exception 'MFA required for marketplace approval' using errcode='42501';end if;
  if new.status='approved' and new.payload->'change'->>'kind'='offer.details' and (not public.has_permission('offers.update_price') or not public.has_permission('offers.update_stock')) then raise exception 'Details require pricing and stock permissions' using errcode='42501';end if;
  lock_name:=new.payload->>'lockKey';
 end if;
 if lock_name is null then raise exception 'Missing marketplace lock';end if;
 perform pg_advisory_xact_lock(hashtextextended(lock_name,916));
 if exists(select 1 from public.offer_availability_operations o where 'offer:'||lower(o.native_id)=lock_name
   and o.status in ('running','unknown') and (tg_table_name<>'offer_availability_operations' or o.id<>new.id))
  or exists(select 1 from public.approval_requests a where a.payload->>'marketV1'='true'
   and a.payload->>'lockKey'=lock_name and a.status in ('pending','approved','executing','blocked')
   and (tg_table_name<>'approval_requests' or a.id<>new.id)) then
  raise exception 'Another marketplace operation needs resolution' using errcode='55000';
 end if;
 return new;
end $$;
create trigger availability_marketplace_lock before insert or update on public.offer_availability_operations
 for each row execute function public.guard_marketplace_lock();
create trigger approval_marketplace_lock before insert or update on public.approval_requests
 for each row execute function public.guard_marketplace_lock();
revoke all on function public.guard_marketplace_lock() from public,anon,authenticated;

create function public.request_marketplace_operation(
 change jsonb,target text,expected_snapshot timestamptz,remote_before jsonb,justification text,request_key uuid
) returns uuid language plpgsql security definer set search_path=public as $$
declare required text;kind text:=change->>'kind';listing public.offers;purchase public.orders;
 content jsonb;result uuid;lock_name text;native text;
begin
 required:=case kind when 'offer.price' then 'offers.update_price' when 'offer.quantity' then 'offers.update_stock'
  when 'offer.details' then 'offers.create' when 'offer.create' then 'offers.create'
  when 'order.deliver' then 'orders.deliver' when 'order.cancel' then 'orders.cancel'
  when 'order.extend' then 'orders.update_delivery' end;
 if required is null or not public.has_permission(required) then raise exception 'Permission denied' using errcode='42501';end if;
 if kind='offer.details' and (not public.has_permission('offers.update_price') or not public.has_permission('offers.update_stock')) then raise exception 'Details require pricing and stock permissions' using errcode='42501';end if;
 if pg_column_size(change)>65536 or pg_column_size(remote_before)>65536 or length(btrim(justification)) not between 10 and 2000 or request_key is null then
  raise exception 'Invalid operation' using errcode='22023';end if;
 if kind in ('offer.create','offer.details') and change->'body'->'giftCardDetails' not in ('null'::jsonb,'[]'::jsonb) then
  raise exception 'Gift card secrets are not accepted' using errcode='22023';end if;
 -- An identical HTTP replay returns the durable ticket, including after completion.
 select id into result from public.approval_requests where idempotency_key=request_key and requester_id=auth.uid()
  and payload->'change'=change and target_id=target and reason=btrim(justification) and (payload->>'expectedSnapshot')::timestamptz is not distinct from expected_snapshot;
 if found then return result;end if;
 if kind='offer.create' then
  if target<>'new' or not public.has_permission('offers.read') then raise exception 'Invalid create scope';end if;
  lock_name:='create:predefined';native:=null;
 elsif kind like 'offer.%' then
  if not public.has_permission('offers.read') then raise exception 'Listing access required' using errcode='42501';end if;
  select * into listing from public.offers where id=target for update;
  if not found or listing.source<>'predefined' or listing.updated_at is distinct from expected_snapshot
   or listing.state not in ('Active','Paused') or remote_before->>'id' is distinct from listing.native_id then
   raise exception 'Synchronize a supported predefined listing first' using errcode='40001';end if;
  native:=listing.native_id;lock_name:='offer:'||lower(native);
 else
  if not public.can_read_order(target::uuid) then raise exception 'Order access required' using errcode='42501';end if;
  select * into purchase from public.orders where id=target::uuid for update;
  if not found or purchase.synced_at is distinct from expected_snapshot or purchase.state<>'Paid'
   or remote_before->>'id' is distinct from target then raise exception 'Synchronize an open order first' using errcode='40001';end if;
  if kind='order.deliver' and exists(select 1 from public.approval_requests a where a.target_id=target and a.payload->'change'->>'kind'='order.deliver' and a.status='succeeded' and a.external_attempted) then raise exception 'Delivery already recorded' using errcode='55000';end if;
  native:=target;lock_name:='order:'||target;
 end if;
 if not public.consume_rate_limit('marketplace.request',10,60) then raise exception 'Rate limited' using errcode='P0001';end if;
 content:=jsonb_build_object('marketV1',true,'change',change,'before',remote_before,'nativeId',native,
  'lockKey',lock_name,'expectedSnapshot',expected_snapshot);
 insert into public.approval_requests(requester_id,action,target_id,reason,idempotency_key,payload)
 values(auth.uid(),required,target,btrim(justification),request_key,content) returning id into result;
 perform public.audit_event('marketplace.requested','approval',result::text,jsonb_build_object('kind',kind,'target',target));
 return result;
end $$;

create function public.claim_marketplace_operation(operation_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare operation public.approval_requests;
begin
 select * into operation from public.approval_requests where id=operation_id for update;
 if not found or operation.payload->>'marketV1' is distinct from 'true' then raise exception 'Operation not found';end if;
 if not public.has_permission(operation.action) or auth.jwt()->>'aal' is distinct from 'aal2'
  or auth.uid() not in (operation.requester_id,operation.approver_id) then raise exception 'MFA and operation access required' using errcode='42501';end if;
 if operation.status<>'approved' or operation.external_attempted or operation.approver_id=operation.requester_id then
  raise exception 'Operation not approved or already claimed' using errcode='55000';end if;
 if (operation.action like 'orders.%' and not public.can_read_order(operation.target_id::uuid)) or (operation.action like 'offers.%' and not public.has_permission('offers.read')) then raise exception 'Target access required' using errcode='42501';end if;
 if operation.payload->'change'->>'kind'='offer.details' and (not public.has_permission('offers.update_price') or not public.has_permission('offers.update_stock') or exists(select 1 from public.users u cross join unnest(array['offers.update_price','offers.update_stock']) as required(permission) where u.id in (operation.requester_id,operation.approver_id) and not coalesce((select allowed from public.user_permission_overrides where user_id=u.id and permission=required.permission),exists(select 1 from public.role_permissions where role=u.role and permission=required.permission)))) then raise exception 'Details require pricing and stock permissions' using errcode='42501';end if;
 -- Both parties must still be active and authorized; approval cannot outlive a permission removal.
 if exists(select 1 from public.users u where u.id in (operation.requester_id,operation.approver_id)
   and (not u.active or not coalesce((select allowed from public.user_permission_overrides where user_id=u.id and permission=operation.action),
    exists(select 1 from public.role_permissions where role=u.role and permission=operation.action))))
  or not exists(select 1 from public.users where id=operation.approver_id and active and role in ('OWNER','ADMIN','SUPERVISOR')) then
  raise exception 'Approval parties no longer authorized' using errcode='42501';end if;
 update public.approval_requests set status='executing',external_attempted=true where id=operation.id returning * into operation;
 perform public.audit_event('marketplace.claimed','approval',operation.id::text,jsonb_build_object('kind',operation.payload->'change'->>'kind'));
 return to_jsonb(operation);
end $$;

create function public.finish_marketplace_operation(operation_id uuid,outcome text,proof jsonb,failure_code text)
 returns jsonb language plpgsql security definer set search_path=public as $$
declare operation public.approval_requests;kind text;desired jsonb;
begin
 select * into operation from public.approval_requests where id=operation_id for update;
 if not found or operation.payload->>'marketV1' is distinct from 'true' then raise exception 'Operation not found';end if;
 if outcome not in ('succeeded','failed','blocked','rejected') or
  (failure_code is not null and failure_code !~ '^[A-Z][A-Z0-9_]{0,99}$') then raise exception 'Invalid outcome';end if;
 if operation.status in ('succeeded','failed','rejected') then return to_jsonb(operation);end if;
 if operation.status='blocked' and outcome not in ('blocked','succeeded') then raise exception 'Unknown operation needs verified reconciliation';end if;
 if outcome='failed' and operation.external_attempted then raise exception 'Attempted operations require a definitive result';end if;
 kind:=operation.payload->'change'->>'kind';desired:=operation.payload->'change'->'body';
 if outcome='succeeded' then
  if not operation.external_attempted or proof is null or proof->>'verified' is distinct from 'true' then raise exception 'Verified result required';end if;
  if kind<>'offer.create' and proof->>'id' is distinct from operation.payload->>'nativeId' then raise exception 'Target mismatch';end if;
  if (kind='offer.price' and (proof->'price' is distinct from desired->'amount' or proof->>'currency' is distinct from desired->>'currency'))
   or (kind='offer.quantity' and proof->'quantity' is distinct from desired)
   or (kind in ('offer.details','offer.create') and proof->'document' is distinct from desired)
   or (kind='order.deliver' and coalesce(proof->>'state','') not in ('Delivered','Received','Completed'))
   or (kind='order.cancel' and coalesce(proof->>'state','') not in ('Canceled','Cancelled')) then raise exception 'Desired outcome not observed';end if;
  if kind like 'offer.%' and kind<>'offer.create' then
   update public.offers set price=(proof->>'price')::numeric,currency=proof->>'currency',quantity=(proof->>'quantity')::numeric,
    state=proof->>'state',updated_at=now() where lower(native_id)=lower(operation.payload->>'nativeId');
  elsif kind like 'order.%' then
   update public.orders set state=proof->>'state',delivery_time=proof->>'deliveryTime',synced_at=now() where id=(operation.payload->>'nativeId')::uuid;
  end if;
 end if;
 update public.approval_requests set status=outcome,result=coalesce(proof,'{}'::jsonb)||jsonb_build_object('errorCode',failure_code)
 where id=operation.id returning * into operation;
 insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
 values(operation.requester_id,'marketplace.finished','approval',operation.id::text,jsonb_build_object('kind',kind,'status',outcome,'errorCode',failure_code,'upstreamAttempted',operation.external_attempted));
 return to_jsonb(operation);
end $$;
revoke all on function public.request_marketplace_operation(jsonb,text,timestamptz,jsonb,text,uuid) from public,anon,authenticated;
revoke all on function public.claim_marketplace_operation(uuid) from public,anon,authenticated;
revoke all on function public.finish_marketplace_operation(uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.request_marketplace_operation(jsonb,text,timestamptz,jsonb,text,uuid),public.claim_marketplace_operation(uuid) to authenticated;
grant execute on function public.finish_marketplace_operation(uuid,text,jsonb,text) to service_role;
