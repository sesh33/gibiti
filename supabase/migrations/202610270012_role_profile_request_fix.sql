-- Forward-safe replacement for local installations created during first setup.
create or replace function public.request_staff_role_profile(target uuid,profile_id uuid,new_active boolean,justification text,request_key uuid) returns uuid language plpgsql security definer set search_path=public as $$declare profile public.role_profiles;request_id uuid;begin
 if not public.has_permission('team.manage_permissions') then raise exception 'Access denied' using errcode='42501';end if;
 select * into profile from public.role_profiles where id=profile_id;if not found then raise exception 'Role profile not found';end if;
 select id into request_id from public.approval_requests where idempotency_key=request_key and requester_id=auth.uid() and action='team.manage_permissions' and target_id=target::text and reason=justification and payload->>'role_profile_id'=profile.id::text and (payload->>'active')::boolean=new_active;if request_id is not null then return request_id;end if;
 request_id:=public.request_staff_access_change(target,profile.base_role,new_active,profile.overrides,justification,request_key);
 update public.approval_requests set payload=payload||jsonb_build_object('role_label',profile.name,'role_profile_id',profile.id) where id=request_id and status='pending';return request_id;
end $$;
