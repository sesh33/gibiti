-- Reusable custom roles retain a base security role (including MFA rules).
create table public.role_profiles(id uuid primary key default gen_random_uuid(),name text unique not null check(length(name) between 2 and 60),base_role public.staff_role not null check(base_role<>'OWNER'),overrides jsonb not null,created_by uuid not null references public.users(id),created_at timestamptz not null default now());
alter table public.role_profiles enable row level security;
revoke all on public.role_profiles from anon,authenticated;
grant all on public.role_profiles to service_role;
grant select on public.role_profiles to authenticated;
create policy read_access on public.role_profiles for select to authenticated using(public.has_permission('team.read'));
alter table public.users add column role_label text;
create function public.create_role_profile(label text,base public.staff_role,overrides jsonb) returns uuid language plpgsql security definer set search_path=public as $$declare result uuid;begin
 if not public.has_permission('team.manage_permissions') or not exists(select 1 from public.users where id=auth.uid() and role='OWNER') then raise exception 'Access denied' using errcode='42501';end if;
 if base='OWNER' or jsonb_typeof(overrides)<>'array' or jsonb_array_length(overrides)>(select count(*) from public.permissions) then raise exception 'Invalid role profile';end if;
 if exists(select 1 from jsonb_array_elements(overrides) x where not exists(select 1 from public.permissions where name=x->>'permission') or jsonb_typeof(x->'allowed') is distinct from 'boolean') then raise exception 'Invalid permissions';end if;
 if (select count(*) from jsonb_array_elements(overrides))<>(select count(distinct x->>'permission') from jsonb_array_elements(overrides) x) then raise exception 'Duplicate permission';end if;
 insert into public.role_profiles(name,base_role,overrides,created_by) values(label,base,overrides,auth.uid()) returning id into result;
 perform public.audit_event('role_profile.created','role_profile',result::text,jsonb_build_object('name',label,'base_role',base));return result;
end $$;
revoke all on function public.create_role_profile(text,public.staff_role,jsonb) from public;
grant execute on function public.create_role_profile(text,public.staff_role,jsonb) to authenticated;
create function public.request_staff_role_profile(target uuid,profile_id uuid,new_active boolean,justification text,request_key uuid) returns uuid language plpgsql security definer set search_path=public as $$declare profile public.role_profiles;request_id uuid;begin
 if not public.has_permission('team.manage_permissions') then raise exception 'Access denied' using errcode='42501';end if;
 select * into profile from public.role_profiles where id=profile_id;if not found then raise exception 'Role profile not found';end if;
 select id into request_id from public.approval_requests where idempotency_key=request_key and requester_id=auth.uid() and action='team.manage_permissions' and target_id=target::text and reason=justification and payload->>'role_profile_id'=profile.id::text and (payload->>'active')::boolean=new_active;if request_id is not null then return request_id;end if;
 request_id:=public.request_staff_access_change(target,profile.base_role,new_active,profile.overrides,justification,request_key);
 update public.approval_requests set payload=payload||jsonb_build_object('role_label',profile.name,'role_profile_id',profile.id) where id=request_id and status='pending';return request_id;
end $$;
revoke all on function public.request_staff_role_profile(uuid,uuid,boolean,text,uuid) from public;
grant execute on function public.request_staff_role_profile(uuid,uuid,boolean,text,uuid) to authenticated;
create function public.apply_approved_role_label() returns trigger language plpgsql security definer set search_path=public as $$begin
 if new.action='team.manage_permissions' and new.status='succeeded' and old.status is distinct from new.status then update public.users set role_label=new.payload->>'role_label' where id=new.target_id::uuid;end if;return new;
end $$;
revoke all on function public.apply_approved_role_label() from public;
create trigger approved_role_label after update of status on public.approval_requests for each row execute function public.apply_approved_role_label();
create function public.audit_staff_access_state() returns trigger language plpgsql security definer set search_path=public as $$begin
 if row(old.role,old.role_label,old.active) is distinct from row(new.role,new.role_label,new.active) then perform public.audit_event('staff.access_state_changed','user',new.id::text,jsonb_build_object('before',jsonb_build_object('role',old.role,'label',old.role_label,'active',old.active),'after',jsonb_build_object('role',new.role,'label',new.role_label,'active',new.active)));end if;return new;
end $$;
revoke all on function public.audit_staff_access_state() from public;
create trigger staff_access_state after update of role,role_label,active on public.users for each row execute function public.audit_staff_access_state();
