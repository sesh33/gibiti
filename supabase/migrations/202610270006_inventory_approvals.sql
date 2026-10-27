-- Extend reviewed internal operations; never changes an Eldorado order.
create or replace function public.decide_approval(target uuid,approve boolean,justification text) returns void language plpgsql security definer set search_path=public as $$
declare approval public.approval_requests;entry jsonb;employee uuid;stock public.inventory_reservations;begin
 select * into approval from public.approval_requests where id=target for update;
 if not found then raise exception 'Approval not found';end if;
 if not public.staff_active() or not exists(select 1 from public.users where id=auth.uid() and role in ('OWNER','ADMIN','SUPERVISOR')) or approval.requester_id=auth.uid() then raise exception 'Access denied' using errcode='42501';end if;
 if approval.action='team.manage_permissions' then
  if not public.has_permission('approvals.review_access') or auth.jwt()->>'aal'<>'aal2' or approval.target_id=auth.uid()::text then raise exception 'Access denied' using errcode='42501';end if;
 else
  if not public.has_permission(approval.action) then raise exception 'Access denied' using errcode='42501';end if;
 end if;
 if approval.status<>'pending' then raise exception 'Approval already decided';end if;
 if length(justification)<3 or length(justification)>2000 then raise exception 'Decision reason required';end if;
 update public.approval_requests set status=case when approve then 'approved' else 'rejected' end,approver_id=auth.uid(),decided_at=now(),decision_reason=justification where id=target;
 if approve and approval.action='team.manage_permissions' then
  employee:=approval.target_id::uuid;
  if not exists(select 1 from public.users where id=employee and role<>'OWNER') or approval.payload->>'role'='OWNER' then raise exception 'Invalid employee';end if;
  -- Revalidate the requester's permission at execution time, without trusting a stale UI/session.
  if not exists(select 1 from public.users u where u.id=approval.requester_id and u.active and coalesce((select allowed from public.user_permission_overrides where user_id=u.id and permission='team.manage_permissions'),exists(select 1 from public.role_permissions where role=u.role and permission='team.manage_permissions'))) then raise exception 'Requester is no longer authorized';end if;
  update public.users set role=(approval.payload->>'role')::public.staff_role,active=(approval.payload->>'active')::boolean where id=employee;
  delete from public.user_permission_overrides where user_id=employee;
  for entry in select * from jsonb_array_elements(approval.payload->'overrides') loop insert into public.user_permission_overrides(user_id,permission,allowed) values(employee,entry->>'permission',(entry->>'allowed')::boolean);end loop;
  update public.employee_sessions set revoked_at=now() where user_id=employee and revoked_at is null;
  update public.approval_requests set status='succeeded',result=jsonb_build_object('sessions_revoked',true) where id=target;
  perform public.audit_event('staff.updated','user',employee::text,jsonb_build_object('approval_id',target));
 elsif approve and approval.action='inventory.manage' and approval.payload->>'operation'='consume' then
  if not exists(select 1 from public.users u where u.id=approval.requester_id and u.active and coalesce((select allowed from public.user_permission_overrides where user_id=u.id and permission='inventory.manage'),exists(select 1 from public.role_permissions where role=u.role and permission='inventory.manage'))) then raise exception 'Requester is no longer authorized';end if;
  select * into stock from public.inventory_reservations where id=(approval.payload->>'reservation')::uuid for update;
  if not found or stock.released_at is not null or stock.item_id::text<>approval.target_id or not public.can_read_order(stock.order_id) then raise exception 'Reservation unavailable';end if;
  perform 1 from public.inventory_items where id=stock.item_id and status='reserved' for update;if not found then raise exception 'Inventory state changed';end if;
  update public.inventory_reservations set released_at=now() where id=stock.id;
  update public.inventory_items set status='delivered' where id=stock.item_id;
  update public.approval_requests set status='succeeded',result=jsonb_build_object('internal_only',true) where id=target;
  perform public.audit_event('inventory.consumed','inventory',stock.item_id::text,jsonb_build_object('approval_id',target,'order',stock.order_id));
 end if;
 perform public.audit_event('approval.decided','approval',target::text,jsonb_build_object('approved',approve));
end $$;
