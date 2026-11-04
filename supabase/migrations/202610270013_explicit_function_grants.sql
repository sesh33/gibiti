-- Managed Supabase can grant EXECUTE directly to anon/authenticated through
-- default ACLs. Revoking PUBLIC alone does not remove those direct grants.
-- Define the complete application RPC boundary explicitly before deployment.
revoke all on function
 public.access_inventory_secret(uuid),
 public.add_internal_note(uuid,text),
 public.apply_approved_role_label(),
 public.assign_order(uuid,uuid),
 public.audit_event(text,text,text,jsonb),
 public.audit_staff_access_state(),
 public.bootstrap_owner(uuid,text,text),
 public.can_read_conversation(uuid),
 public.can_read_order(uuid),
 public.consume_rate_limit(text,integer,integer),
 public.create_inventory(text,text,text,text),
 public.create_role_profile(text,public.staff_role,jsonb),
 public.decide_approval(uuid,boolean,text),
 public.finish_inventory_reservation(uuid,boolean,text),
 public.has_permission(text),
 public.manage_staff(uuid,public.staff_role,boolean,jsonb),
 public.my_permissions(),
 public.persist_offer_page(jsonb,text,jsonb,uuid,uuid),
 public.persist_order_page(jsonb,jsonb,text,uuid,uuid),
 public.record_employee_login(),
 public.record_inventory_movement(),
 public.register_employee_session(),
 public.request_approval(text,text,text,uuid),
 public.request_inventory_consumption(uuid,text,uuid),
 public.request_staff_access_change(uuid,public.staff_role,boolean,jsonb,text,uuid),
 public.request_staff_role_profile(uuid,uuid,boolean,text,uuid),
 public.reserve_inventory(uuid,uuid),
 public.revoke_own_employee_session(),
 public.revoke_staff_sessions(uuid),
 public.staff_active()
from public,anon,authenticated;

-- These functions independently verify session, membership, MFA, permissions,
-- assignment and/or approval separation before reading or changing records.
grant execute on function
 public.access_inventory_secret(uuid),
 public.add_internal_note(uuid,text),
 public.assign_order(uuid,uuid),
 public.can_read_conversation(uuid),
 public.can_read_order(uuid),
 public.consume_rate_limit(text,integer,integer),
 public.create_inventory(text,text,text,text),
 public.create_role_profile(text,public.staff_role,jsonb),
 public.decide_approval(uuid,boolean,text),
 public.finish_inventory_reservation(uuid,boolean,text),
 public.has_permission(text),
 public.my_permissions(),
 public.register_employee_session(),
 public.request_approval(text,text,text,uuid),
 public.request_inventory_consumption(uuid,text,uuid),
 public.request_staff_access_change(uuid,public.staff_role,boolean,jsonb,text,uuid),
 public.request_staff_role_profile(uuid,uuid,boolean,text,uuid),
 public.reserve_inventory(uuid,uuid),
 public.revoke_own_employee_session(),
 public.revoke_staff_sessions(uuid),
 public.staff_active()
to authenticated;

grant execute on function
 public.bootstrap_owner(uuid,text,text),
 public.persist_offer_page(jsonb,text,jsonb,uuid,uuid),
 public.persist_order_page(jsonb,jsonb,text,uuid,uuid)
to service_role;

-- PUBLIC has a built-in global EXECUTE default. A per-schema REVOKE alone
-- cannot override it, so remove that global default for this migration owner
-- and remove Supabase's schema-specific grants. Future RPCs must opt in.
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from public,anon,authenticated;
