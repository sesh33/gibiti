-- Permission changes require a distinct, MFA-protected reviewer. Invitations remain Owner-confirmed.
insert into public.permissions(name) values('approvals.review_access');
insert into public.role_permissions(role,permission) values('OWNER','approvals.review_access'),('ADMIN','approvals.review_access');
alter table public.approval_requests drop constraint approval_requests_action_check;
alter table public.approval_requests add constraint approval_requests_action_check check(action in ('orders.deliver','orders.cancel','orders.update_delivery','offers.delete','offers.update_price','inventory.manage','team.manage_permissions'));
alter table public.approval_requests add column payload jsonb;
-- Remove the former direct mutation path, including explicit grants.
revoke all on function public.manage_staff(uuid,public.staff_role,boolean,jsonb) from authenticated,public;
create function public.request_staff_access_change(target uuid,new_role public.staff_role,new_active boolean,overrides jsonb,justification text,request_key uuid) returns uuid language plpgsql security definer set search_path=public as $$declare result uuid;content jsonb;begin
 if not public.has_permission('team.manage_permissions') then raise exception 'Access denied' using errcode='42501';end if;
 if target=auth.uid() or new_role='OWNER' or not exists(select 1 from public.users where id=target and role<>'OWNER') then raise exception 'Owner and self changes are not allowed' using errcode='42501';end if;
 if jsonb_typeof(overrides)<>'array' or jsonb_array_length(overrides)>(select count(*) from public.permissions) then raise exception 'Invalid overrides';end if;
 if exists(select 1 from jsonb_array_elements(overrides) entry where not exists(select 1 from public.permissions where name=entry->>'permission') or jsonb_typeof(entry->'allowed')<>'boolean') then raise exception 'Invalid overrides';end if;
 content:=jsonb_build_object('role',new_role,'active',new_active,'overrides',overrides);
 select id into result from public.approval_requests where idempotency_key=request_key and requester_id=auth.uid() and action='team.manage_permissions' and target_id=target::text and reason=justification and payload=content;if result is not null then return result;end if;
 insert into public.approval_requests(requester_id,action,target_id,reason,idempotency_key,payload) values(auth.uid(),'team.manage_permissions',target::text,justification,request_key,content) returning id into result;
 perform public.audit_event('staff.access_change_requested','user',target::text,jsonb_build_object('approval_id',result));return result;
end $$;
revoke all on function public.request_staff_access_change(uuid,public.staff_role,boolean,jsonb,text,uuid) from public;
grant execute on function public.request_staff_access_change(uuid,public.staff_role,boolean,jsonb,text,uuid) to authenticated;

create or replace function public.decide_approval(target uuid,approve boolean,justification text) returns void language plpgsql security definer set search_path=public as $$
declare approval public.approval_requests;entry jsonb;employee uuid;begin
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
 end if;
 perform public.audit_event('approval.decided','approval',target::text,jsonb_build_object('approved',approve));
end $$;
drop policy read_access on public.approval_requests;
create policy read_access on public.approval_requests for select to authenticated using(public.staff_active() and (requester_id=auth.uid() or ((public.has_permission(action) or (action='team.manage_permissions' and public.has_permission('approvals.review_access'))) and exists(select 1 from public.users where id=auth.uid() and role in ('OWNER','ADMIN','SUPERVISOR')))));
