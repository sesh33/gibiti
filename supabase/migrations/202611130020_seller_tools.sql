-- Each installation belongs to exactly one seller. Account actions and exports
-- have separate permissions and never expose the Seller credential to staff.
insert into public.permissions(name) values('seller.read'),('seller.manage'),('notifications.read'),('notifications.manage'),('reports.export');
insert into public.role_permissions(role,permission)
 select r,p from unnest(array['OWNER','ADMIN']::public.staff_role[]) r cross join unnest(array['seller.read','notifications.read','notifications.manage','reports.export']) p;
insert into public.role_permissions values('OWNER','seller.manage');

create table public.seller_actions (
 id uuid primary key default gen_random_uuid(),requester_id uuid not null references public.users(id),session_id uuid not null,
 idempotency_key uuid not null unique,kind text not null check(kind in ('seller.online','seller.offline','notification.read','notifications.read_all')),
 notification_id text,reason text not null check(length(reason) between 10 and 2000),
 status text not null default 'running' check(status in ('running','acknowledged','rejected','unknown','manually_checked')),
 error_code text,created_at timestamptz not null default now(),finished_at timestamptz,
 check((kind='notification.read' and notification_id is not null and notification_id ~ '^[A-Za-z0-9_-]{1,150}$') or (kind<>'notification.read' and notification_id is null))
);
create unique index one_pending_seller_availability on public.seller_actions((true)) where kind in ('seller.online','seller.offline') and status in ('running','unknown');
create unique index one_pending_notification_action on public.seller_actions((coalesce(notification_id,'ALL'))) where kind like 'notification%' and status in ('running','unknown');
alter table public.seller_actions enable row level security;
revoke all on public.seller_actions from public,anon,authenticated;
grant select on public.seller_actions to authenticated;
grant select,update on public.seller_actions to service_role;
create policy seller_actions_read on public.seller_actions for select to authenticated using(public.staff_active() and (requester_id=auth.uid() or public.has_permission('audit.read')));

create function public.begin_seller_action(action_kind text,notification text,justification text,request_key uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare result public.seller_actions;required text;
begin
 required:=case when action_kind in ('seller.online','seller.offline') then 'seller.manage' when action_kind in ('notification.read','notifications.read_all') then 'notifications.manage' end;
 if required is null or not public.has_permission(required) or auth.jwt()->>'aal' is distinct from 'aal2'
  or (required='seller.manage' and not exists(select 1 from public.users where id=auth.uid() and active and role='OWNER'))
  or (required='notifications.manage' and not public.has_permission('notifications.read')) then raise exception 'MFA and Seller permission required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('seller-actions',916));
 select * into result from public.seller_actions where idempotency_key=request_key;
 if found then
  if result.requester_id<>auth.uid() or result.kind<>action_kind or result.notification_id is distinct from notification or result.reason<>btrim(justification) then raise exception 'Idempotency conflict' using errcode='22023';end if;
  return jsonb_build_object('operation',to_jsonb(result),'claimed',false);
 end if;
 if length(btrim(justification)) not between 10 and 2000 or request_key is null then raise exception 'Reason required';end if;
 if required='notifications.manage' and exists(select 1 from public.seller_actions where status in ('running','unknown') and
   (kind='notifications.read_all' or (action_kind='notifications.read_all' and kind='notification.read') or (kind='notification.read' and notification_id=notification))) then
   raise exception 'Reconcile the pending notification action first' using errcode='55000';end if;
 if not public.consume_rate_limit('operations.write',30,60) then raise exception 'Rate limited';end if;
 insert into public.seller_actions(requester_id,session_id,idempotency_key,kind,notification_id,reason)
 values(auth.uid(),(auth.jwt()->>'session_id')::uuid,request_key,action_kind,notification,btrim(justification)) returning * into result;
 perform public.audit_event('seller.action_claimed','seller_action',result.id::text,jsonb_build_object('kind',action_kind));
 return jsonb_build_object('operation',to_jsonb(result),'claimed',true);
end $$;

create function public.authorize_seller_action(operation_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare item public.seller_actions;required text;
begin
 select * into item from public.seller_actions where id=operation_id;
 required:=case when item.kind in ('seller.online','seller.offline') then 'seller.manage' else 'notifications.manage' end;
 if item.id is null or item.status<>'running' or not public.market_user_authorized(item.requester_id,required)
  or (required='seller.manage' and not exists(select 1 from public.users where id=item.requester_id and role='OWNER' and active))
  or (required='notifications.manage' and not public.market_user_authorized(item.requester_id,'notifications.read'))
  or not exists(select 1 from public.employee_sessions where id=item.session_id and user_id=item.requester_id and revoked_at is null)
  or exists(select 1 from public.revoked_auth_sessions where session_id=item.session_id) then raise exception 'Seller action authority revoked' using errcode='42501';end if;
end $$;

create function public.finish_seller_action(operation_id uuid,outcome text,failure_code text) returns jsonb language plpgsql security definer set search_path=public as $$
declare result public.seller_actions;
begin
 if outcome not in ('acknowledged','rejected','unknown') or (failure_code is not null and failure_code !~ '^[A-Z][A-Z0-9_]{0,99}$') then raise exception 'Invalid Seller outcome';end if;
 select * into result from public.seller_actions where id=operation_id for update;
 if not found then raise exception 'Seller action missing';end if;
 if result.status<>'running' then return to_jsonb(result);end if;
 update public.seller_actions set status=outcome,error_code=failure_code,finished_at=now() where id=operation_id returning * into result;
 insert into public.audit_logs(actor_id,action,target_type,target_id,metadata) values(result.requester_id,'seller.action_finished','seller_action',result.id::text,jsonb_build_object('kind',result.kind,'status',result.status,'errorCode',failure_code));
 return to_jsonb(result);
end $$;

create function public.record_seller_manual_check(operation_id uuid,justification text) returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.has_permission('settings.manage') or auth.jwt()->>'aal' is distinct from 'aal2' or length(btrim(justification)) not between 20 and 2000
  or not exists(select 1 from public.users where id=auth.uid() and active and role='OWNER') then raise exception 'MFA Owner and independent manual check required' using errcode='42501';end if;
 update public.seller_actions set status='manually_checked',finished_at=now() where id=operation_id and status in ('running','unknown') and created_at<now()-interval '1 minute';
 if not found then raise exception 'The action is completed or still within its request window';end if;
 perform public.audit_event('seller.action_manually_checked','seller_action',operation_id::text,jsonb_build_object('reason',btrim(justification),'upstreamWriteSent',false));
end $$;

create function public.record_report_export(report_kind text,from_day date,until_day date,byte_count integer) returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.has_permission('reports.export') or not public.has_permission('orders.read') or auth.jwt()->>'aal' is distinct from 'aal2' then raise exception 'MFA report export permission required' using errcode='42501';end if;
 if report_kind not in ('orders','sold-orders','invoice') or until_day<from_day or until_day-from_day>366 or byte_count not between 1 and 10485760 then raise exception 'Invalid report';end if;
 perform public.audit_event('seller.report_exported','report',report_kind,jsonb_build_object('from',from_day,'until',until_day,'bytes',byte_count));
end $$;
revoke all on function public.begin_seller_action(text,text,text,uuid),public.authorize_seller_action(uuid),public.finish_seller_action(uuid,text,text),public.record_seller_manual_check(uuid,text),public.record_report_export(text,date,date,integer) from public,anon,authenticated;
grant execute on function public.begin_seller_action(text,text,text,uuid),public.record_seller_manual_check(uuid,text),public.record_report_export(text,date,date,integer) to authenticated;
grant execute on function public.authorize_seller_action(uuid),public.finish_seller_action(uuid,text,text) to service_role;
