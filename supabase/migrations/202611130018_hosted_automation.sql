-- Server-side scheduling uses durable leases, explicitly authorized machine
-- sessions and existing marketplace idempotency. No automation is enabled here.
alter table public.employee_sessions add column session_kind text not null default 'employee' check(session_kind in ('employee','automation'));
create table public.automation_runtime (
 id boolean primary key default true check(id),actor_id uuid references public.users(id),session_id uuid references public.employee_sessions(id),
 lease_token uuid,leased_until timestamptz,backoff_until timestamptz,failures integer not null default 0,
 last_error_code text,last_heartbeat_at timestamptz,last_poll_at timestamptz,poll_watermark timestamptz,
 worker_origin text,scheduler_configured boolean not null default false
);
insert into public.automation_runtime(id) values(true);
create table public.automation_sync_cursors(cursor text primary key,stop_at timestamptz,created_at timestamptz not null default now());
alter table public.automation_runtime enable row level security;
alter table public.automation_sync_cursors enable row level security;
revoke all on public.automation_runtime,public.automation_sync_cursors from public,anon,authenticated;
grant all on public.automation_runtime,public.automation_sync_cursors to service_role;

create function public.market_user_authorized(actor uuid,required text) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.users u where id=actor and active and coalesce(
  (select allowed from public.user_permission_overrides where user_id=u.id and permission=required),
  exists(select 1 from public.role_permissions where role=u.role and permission=required)))
$$;
create function public.automatic_policy_authorized(policy_id uuid,expected_version uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.repricing_policies p join public.workspace_preferences w on w.id
  where p.id=policy_id and p.version=expected_version and p.mode='automatic' and p.review_status='approved'
   and w.auto_pricing_enabled and p.approved_by is not null and p.approved_by<>p.created_by
   and exists(select 1 from public.users where id=p.created_by and role='OWNER' and active)
   and exists(select 1 from public.users where id=p.approved_by and role in ('OWNER','ADMIN','SUPERVISOR') and active)
   and public.market_user_authorized(p.created_by,'offers.read') and public.market_user_authorized(p.created_by,'offers.update_price')
   and public.market_user_authorized(p.approved_by,'offers.read') and public.market_user_authorized(p.approved_by,'offers.update_price'))
$$;
create function public.automatic_approval_allowed(content jsonb) returns boolean language plpgsql stable security definer set search_path=public as $$
begin
 if auth.jwt()->>'role' is distinct from 'service_role' or content->>'automaticPolicyId' is null or content->>'automaticPolicyVersion' is null then return false;end if;
 return public.automatic_policy_authorized((content->>'automaticPolicyId')::uuid,(content->>'automaticPolicyVersion')::uuid);
end $$;

create function public.request_marketplace_with_delivery_optin(change jsonb,target text,expected_snapshot timestamptz,remote_before jsonb,justification text,request_key uuid,transfer_confirmed boolean)
 returns uuid language plpgsql security definer set search_path=public as $$
declare ticket uuid;prior public.approval_requests;
begin
 if change->>'kind'<>'order.deliver' or transfer_confirmed is distinct from true then raise exception 'Verified delivery request required';end if;
 ticket:=public.request_marketplace_operation(change,target,expected_snapshot,remote_before,justification,request_key);
 select * into prior from public.approval_requests where id=ticket;
 if prior.automatic_delivery_requested and prior.fulfillment_confirmed_at is not null then return ticket;end if;
 perform public.request_automatic_delivery(ticket,transfer_confirmed);
 return ticket;
end $$;

create function public.request_delivery_correction(change jsonb,target text,expected_snapshot timestamptz,remote_before jsonb,justification text,request_key uuid)
 returns uuid language plpgsql security definer set search_path=public as $$
declare purchase public.orders;ticket uuid;
begin
 if not public.has_permission('orders.update_delivery') or not public.can_read_order(target::uuid) then raise exception 'Order permission required' using errcode='42501';end if;
 if change->>'kind' is distinct from 'order.correct' or not coalesce(change->'body' ? 'message',false) or jsonb_typeof(change->'body'->'message') not in ('string','null') or pg_column_size(change)>65536
  or length(btrim(justification)) not between 10 and 2000 then raise exception 'Invalid correction request';end if;
 select id into ticket from public.approval_requests where requester_id=auth.uid() and idempotency_key=request_key and payload->'change'=change and target_id=target and reason=btrim(justification);
 if found then return ticket;end if;
 select * into purchase from public.orders where id=target::uuid for update;
 if not found or purchase.state<>'Delivered' or purchase.synced_at is distinct from expected_snapshot or remote_before->>'id' is distinct from target or remote_before->>'state' is distinct from 'Delivered' then raise exception 'Synchronize an eligible delivered order first';end if;
 if not public.consume_rate_limit('operations.write',30,60) then raise exception 'Rate limited';end if;
 insert into public.approval_requests(requester_id,action,target_id,reason,idempotency_key,payload)
 values(auth.uid(),'orders.update_delivery',target,btrim(justification),request_key,jsonb_build_object('marketV1',true,'change',change,'before',remote_before,'nativeId',target,'lockKey','order:'||target,'expectedSnapshot',expected_snapshot)) returning id into ticket;
 perform public.audit_event('delivery.correction_requested','approval',ticket::text);
 return ticket;
end $$;
revoke all on function public.request_marketplace_with_delivery_optin(jsonb,text,timestamptz,jsonb,text,uuid,boolean),public.request_delivery_correction(jsonb,text,timestamptz,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.request_marketplace_with_delivery_optin(jsonb,text,timestamptz,jsonb,text,uuid,boolean),public.request_delivery_correction(jsonb,text,timestamptz,jsonb,text,uuid) to authenticated;

create function public.save_workspace_preferences(polling boolean,seconds integer,auto_delivery boolean,auto_pricing boolean,activation_confirmed boolean)
 returns jsonb language plpgsql security definer set search_path=public as $$
declare settings public.workspace_preferences;runtime public.automation_runtime;machine_session uuid;
begin
 if not public.has_permission('settings.manage') or auth.jwt()->>'aal' is distinct from 'aal2'
  or not exists(select 1 from public.users where id=auth.uid() and active and role='OWNER') then raise exception 'MFA Owner required' using errcode='42501';end if;
 if (auto_delivery or auto_pricing) and activation_confirmed is distinct from true then raise exception 'Explicit automation authorization required';end if;
 select * into runtime from public.automation_runtime where id for update;
 if polling or auto_delivery or auto_pricing then
  machine_session:=runtime.session_id;
  if machine_session is null or not exists(select 1 from public.employee_sessions where id=machine_session and user_id=auth.uid() and session_kind='automation' and revoked_at is null) then
   machine_session:=gen_random_uuid();insert into public.employee_sessions(id,user_id,session_kind) values(machine_session,auth.uid(),'automation');
  end if;
  update public.automation_runtime set actor_id=auth.uid(),session_id=machine_session,backoff_until=null,failures=0 where id;
 end if;
 update public.workspace_preferences set poll_enabled=polling,poll_seconds=seconds,auto_delivery_enabled=auto_delivery,auto_pricing_enabled=auto_pricing,updated_by=auth.uid(),updated_at=now() where id returning * into settings;
 perform public.audit_event('automation.workspace_saved','workspace','default',jsonb_build_object('polling',polling,'automatic_delivery',auto_delivery,'automatic_pricing',auto_pricing));
 return to_jsonb(settings);
end $$;

create function public.claim_automation_tick() returns jsonb language plpgsql security definer set search_path=public as $$
declare runtime public.automation_runtime;settings public.workspace_preferences;lease uuid;policy public.repricing_policies;ticket public.approval_requests;
begin
 select * into runtime from public.automation_runtime where id for update;
 select * into settings from public.workspace_preferences where id;
 if (runtime.leased_until>now()) or (runtime.backoff_until>now()) then return null;end if;
 if not (settings.poll_enabled or settings.auto_delivery_enabled or settings.auto_pricing_enabled) then return null;end if;
 if runtime.actor_id is null or not exists(select 1 from public.users where id=runtime.actor_id and active and role='OWNER')
  or not exists(select 1 from public.employee_sessions where id=runtime.session_id and user_id=runtime.actor_id and session_kind='automation' and revoked_at is null) then return null;end if;
 lease:=gen_random_uuid();update public.automation_runtime set lease_token=lease,leased_until=now()+interval '55 seconds',last_heartbeat_at=now() where id;
 -- Rejected unclaimed automatic tickets cannot hold a listing forever after a
 -- policy revision or stop switch. Never reset executing/uncertain tickets.
 update public.approval_requests a set status='rejected',result=jsonb_build_object('errorCode','AUTOMATION_AUTHORITY_CHANGED')
  where a.status='approved' and not a.external_attempted and a.payload->>'automaticPolicyId' is not null
   and not public.automatic_policy_authorized((a.payload->>'automaticPolicyId')::uuid,(a.payload->>'automaticPolicyVersion')::uuid);
 select * into ticket from public.approval_requests a where a.status in ('approved','executing','blocked') and (a.status='approved' or nullif(a.result->>'automationNextCheckAt','')::timestamptz is null or (a.result->>'automationNextCheckAt')::timestamptz<=now()) and (
  (settings.auto_delivery_enabled and a.automatic_delivery_requested and a.fulfillment_confirmed_at is not null and a.payload->'change'->>'kind'='order.deliver')
  or (settings.auto_pricing_enabled and a.payload->>'automaticPolicyId' is not null and public.automatic_policy_authorized((a.payload->>'automaticPolicyId')::uuid,(a.payload->>'automaticPolicyVersion')::uuid)))
  order by case when a.status in ('executing','blocked') then 0 else 1 end,a.created_at limit 1;
 if ticket.id is null and settings.auto_pricing_enabled then
  select * into policy from public.repricing_policies p where p.next_run_at<=now() and public.automatic_policy_authorized(p.id,p.version) and not exists(select 1 from public.approval_requests where payload->>'lockKey'='offer:'||p.native_id::text and status in ('pending','approved','executing','blocked')) and not exists(select 1 from public.offer_availability_operations where lower(native_id)=p.native_id::text and status in ('running','unknown')) order by p.next_run_at limit 1;
 end if;
 return jsonb_build_object('lease',lease,'actorId',runtime.actor_id,'sessionId',runtime.session_id,
  'pollDue',settings.poll_enabled and public.market_user_authorized(runtime.actor_id,'orders.read') and (runtime.last_poll_at is null or runtime.last_poll_at<now()-make_interval(secs=>settings.poll_seconds)),
  'watermark',runtime.poll_watermark,'operationId',ticket.id,'policy',case when policy.id is null then null else to_jsonb(policy) end);
end $$;

create function public.assert_automation_authority(operation_id uuid,lease uuid) returns void language plpgsql security definer set search_path=public as $$
declare ticket public.approval_requests;runtime public.automation_runtime;
begin
 select * into runtime from public.automation_runtime where id and lease_token=lease and leased_until>now();
 select * into ticket from public.approval_requests where id=operation_id;
 if runtime.actor_id is null or ticket.id is null or not exists(select 1 from public.employee_sessions where id=runtime.session_id and user_id=runtime.actor_id and session_kind='automation' and revoked_at is null)
  or not exists(select 1 from public.users where id=runtime.actor_id and role='OWNER' and active)
  or not public.market_user_authorized(runtime.actor_id,ticket.action) then raise exception 'Automation authority is inactive' using errcode='42501';end if;
 if ticket.payload->>'automaticPolicyId' is not null then
  if not public.automatic_policy_authorized((ticket.payload->>'automaticPolicyId')::uuid,(ticket.payload->>'automaticPolicyVersion')::uuid) then raise exception 'Automatic pricing was disabled or changed' using errcode='42501';end if;
 elsif ticket.payload->'change'->>'kind'='order.deliver' then
  if not ticket.automatic_delivery_requested or ticket.fulfillment_confirmed_at is null or not public.market_user_authorized(runtime.actor_id,'orders.read')
   or not exists(select 1 from public.workspace_preferences where id and auto_delivery_enabled) then raise exception 'Verified delivery opt-in required' using errcode='42501';end if;
 else raise exception 'This operation is not eligible for automation' using errcode='42501';end if;
 if ticket.approver_id is null or ticket.requester_id=ticket.approver_id or not public.market_user_authorized(ticket.requester_id,ticket.action)
  or not public.market_user_authorized(ticket.approver_id,ticket.action)
  or not exists(select 1 from public.users where id=ticket.approver_id and active and role in ('OWNER','ADMIN','SUPERVISOR')) then raise exception 'Independent approval is no longer valid' using errcode='42501';end if;
 if ticket.action like 'orders.%' and not (public.market_user_authorized(ticket.requester_id,'orders.read') or
  (public.market_user_authorized(ticket.requester_id,'orders.read_assigned') and exists(select 1 from public.order_assignments where order_id=ticket.target_id::uuid and user_id=ticket.requester_id))) then raise exception 'Requester lost order access' using errcode='42501';end if;
end $$;

create function public.claim_automated_operation(operation_id uuid,lease uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare ticket public.approval_requests;
begin
 select * into ticket from public.approval_requests where id=operation_id for update;
 perform public.assert_automation_authority(operation_id,lease);
 if ticket.status<>'approved' or ticket.external_attempted then raise exception 'Operation already claimed' using errcode='55000';end if;
 if ticket.payload->'change'->>'kind'='order.deliver' and (
  not exists(select 1 from public.orders where id=ticket.target_id::uuid and state='Paid') or
  exists(select 1 from public.approval_requests where id<>ticket.id and target_id=ticket.target_id and payload->'change'->>'kind'='order.deliver' and status='succeeded' and external_attempted)) then raise exception 'Order is not eligible for another delivery' using errcode='55000';end if;
 update public.approval_requests set status='executing',external_attempted=true where id=ticket.id returning * into ticket;
 insert into public.audit_logs(actor_id,action,target_type,target_id,metadata) values(ticket.requester_id,'automation.operation_claimed','approval',ticket.id::text,jsonb_build_object('kind',ticket.payload->'change'->>'kind'));
 return to_jsonb(ticket);
end $$;

create function public.begin_automatic_repricing(quote_id uuid,lease uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare quote public.repricing_quotes;policy public.repricing_policies;ticket public.approval_requests;content jsonb;
begin
 select * into ticket from public.approval_requests where idempotency_key=quote_id;
 if found then return to_jsonb(ticket);end if;
 select * into quote from public.repricing_quotes where id=quote_id;
 select * into policy from public.repricing_policies where id=quote.policy_id;
 if policy.id is null or quote.expires_at<now() or quote.policy_version<>policy.version or quote.requested_by<>policy.created_by
  or quote.currency<>policy.currency or quote.amount<policy.floor or quote.proof->>'complete' is distinct from 'true'
  or not public.automatic_policy_authorized(policy.id,policy.version)
  or not exists(select 1 from public.automation_runtime where id and lease_token=lease and leased_until>now()) then raise exception 'Automatic quote is not authorized' using errcode='42501';end if;
 content:=jsonb_build_object('marketV1',true,'change',jsonb_build_object('kind','offer.price','body',jsonb_build_object('amount',quote.amount,'currency',quote.currency)),
  'before',quote.before_snapshot,'nativeId',policy.native_id::text,'lockKey','offer:'||policy.native_id::text,
  'automaticPolicyId',policy.id,'automaticPolicyVersion',policy.version);
 insert into public.approval_requests(requester_id,approver_id,action,target_id,reason,status,idempotency_key,payload,repricing_quote_id,decided_at,decision_reason)
 values(policy.created_by,policy.approved_by,'offers.update_price',policy.offer_id,'Automatic repricing under an independently approved policy','approved',quote.id,content,quote.id,now(),'Scoped automatic price authority') returning * into ticket;
 insert into public.audit_logs(actor_id,action,target_type,target_id,metadata) values(policy.created_by,'repricing.automatic_requested','approval',ticket.id::text,jsonb_build_object('policy',policy.id,'version',policy.version,'quote',quote.id));
 return to_jsonb(ticket);
end $$;

create function public.complete_automation_poll(lease uuid,new_watermark timestamptz,gap_cursor text,gap_stop timestamptz,processed_cursor text,continued_cursor text,continued_stop timestamptz)
 returns void language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from public.automation_runtime where id and lease_token=lease) then raise exception 'Worker lease changed';end if;
 if gap_cursor is not null then insert into public.automation_sync_cursors(cursor,stop_at) values(gap_cursor,gap_stop) on conflict do nothing;end if;
 if processed_cursor is not null then
  delete from public.automation_sync_cursors where cursor=processed_cursor;
  if continued_cursor is not null then insert into public.automation_sync_cursors(cursor,stop_at) values(continued_cursor,continued_stop) on conflict do nothing;end if;
 end if;
 update public.automation_runtime set poll_watermark=greatest(poll_watermark,new_watermark),last_poll_at=now() where id and lease_token=lease;
end $$;

create function public.cancel_stale_automatic_tickets() returns integer language plpgsql security definer set search_path=public as $$
declare ticket public.approval_requests;total integer:=0;
begin
 for ticket in select * from public.approval_requests a where a.status='approved' and not a.external_attempted
  and a.payload->>'automaticPolicyId' is not null and not public.automatic_policy_authorized((a.payload->>'automaticPolicyId')::uuid,(a.payload->>'automaticPolicyVersion')::uuid)
  for update skip locked loop
  update public.approval_requests set status='rejected',result=jsonb_build_object('errorCode','AUTOMATION_AUTHORITY_CHANGED') where id=ticket.id;
  insert into public.audit_logs(actor_id,action,target_type,target_id,metadata) values(ticket.requester_id,'repricing.unclaimed_cancelled','approval',ticket.id::text,'{}');total:=total+1;
 end loop;
 return total;
end $$;
revoke all on function public.cancel_stale_automatic_tickets() from public,anon,authenticated;
grant execute on function public.cancel_stale_automatic_tickets() to service_role;

create function public.release_automation_tick(lease uuid,failure_code text,retry_seconds integer) returns void language plpgsql security definer set search_path=public as $$
begin
 update public.automation_runtime set lease_token=null,leased_until=null,last_error_code=failure_code,
  failures=case when failure_code is null then 0 else failures+1 end,
  backoff_until=case when failure_code is null then null else now()+make_interval(secs=>greatest(60,retry_seconds)) end
 where id and lease_token=lease;
end $$;

revoke all on function public.market_user_authorized(uuid,text),public.automatic_policy_authorized(uuid,uuid),public.automatic_approval_allowed(jsonb),public.claim_automation_tick(),public.assert_automation_authority(uuid,uuid),public.claim_automated_operation(uuid,uuid),public.begin_automatic_repricing(uuid,uuid),public.complete_automation_poll(uuid,timestamptz,text,timestamptz,text,text,timestamptz),public.release_automation_tick(uuid,text,integer),public.save_workspace_preferences(boolean,integer,boolean,boolean,boolean) from public,anon,authenticated;
grant execute on function public.save_workspace_preferences(boolean,integer,boolean,boolean,boolean) to authenticated;
grant execute on function public.claim_automation_tick(),public.assert_automation_authority(uuid,uuid),public.claim_automated_operation(uuid,uuid),public.begin_automatic_repricing(uuid,uuid),public.complete_automation_poll(uuid,timestamptz,text,timestamptz,text,text,timestamptz),public.release_automation_tick(uuid,text,integer) to service_role;

-- Preserve the shared lock boundary; only service-created, independently
-- approved scoped policies may substitute for the human execution session.
create or replace function public.guard_marketplace_lock() returns trigger language plpgsql security definer set search_path=public as $$
declare lock_name text;
begin
 if tg_table_name='offer_availability_operations' then
  if new.status not in ('running','unknown') then return new;end if;
  lock_name:='offer:'||lower(new.native_id);
 else
  if new.payload->>'marketV1' is distinct from 'true' or new.status not in ('pending','approved','executing','blocked') then return new;end if;
  if new.status='approved' and auth.jwt()->>'aal' is distinct from 'aal2' and not public.automatic_approval_allowed(new.payload) then raise exception 'MFA required for marketplace approval' using errcode='42501';end if;
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

create or replace function public.claim_marketplace_operation(operation_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare operation public.approval_requests;
begin
 select * into operation from public.approval_requests where id=operation_id for update;
 if not found or operation.payload->>'marketV1' is distinct from 'true' then raise exception 'Operation not found';end if;
 if not public.has_permission(operation.action) or auth.jwt()->>'aal' is distinct from 'aal2'
  or auth.uid() not in (operation.requester_id,operation.approver_id) then raise exception 'MFA and operation access required' using errcode='42501';end if;
 if operation.payload->>'automaticPolicyId' is not null then raise exception 'The hosted runner owns this scoped automatic ticket' using errcode='42501';end if;
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
