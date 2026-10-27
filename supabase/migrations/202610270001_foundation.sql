-- RIVOX Control: private, single-organization workspace. Apply with Supabase migrations.
create extension if not exists pgcrypto;
revoke create on schema public from public,anon,authenticated;
grant usage on schema public to anon,authenticated,service_role;
create type public.staff_role as enum ('OWNER','ADMIN','SUPERVISOR','SUPPORT_AGENT','FULFILLMENT_AGENT','VIEWER');
create table public.roles (name public.staff_role primary key);
insert into public.roles select unnest(enum_range(null::public.staff_role));
create table public.permissions (name text primary key);
create table public.role_permissions (role public.staff_role references public.roles(name),permission text references public.permissions(name),primary key(role,permission));
create table public.users (id uuid primary key references auth.users(id),email text not null,display_name text not null,role public.staff_role not null default 'VIEWER',active boolean not null default true,created_at timestamptz not null default now());
create unique index one_owner on public.users ((role)) where role='OWNER';
create table public.user_permission_overrides(user_id uuid references public.users(id),permission text references public.permissions(name),allowed boolean not null,primary key(user_id,permission));
create table public.employee_sessions(id uuid primary key,user_id uuid not null references public.users(id),created_at timestamptz not null default now(),last_seen_at timestamptz not null default now(),revoked_at timestamptz);
create index employee_sessions_user on public.employee_sessions(user_id);
create table public.orders(id uuid primary key,buyer_id text,buyer_username text not null,offer_id uuid,quantity numeric not null check(quantity>=0),amount numeric not null,currency text not null,state text not null,product_title text not null,game_id text,delivery_method text,delivery_time text,conversation_ref text,purchased_at timestamptz not null,synced_at timestamptz not null default now(),details jsonb not null default '{}');
create table public.order_state_history(id uuid primary key default gen_random_uuid(),order_id uuid not null references public.orders(id),state text not null,occurred_at timestamptz not null,unique(order_id,state,occurred_at));
create table public.order_assignments(order_id uuid primary key references public.orders(id),user_id uuid not null references public.users(id),assigned_by uuid not null references public.users(id),assigned_at timestamptz not null default now());
create table public.offers(id text primary key,category text not null,title text not null,state text not null,price numeric,currency text,quantity numeric,updated_at timestamptz not null default now());
create table public.inventory_items(id uuid primary key default gen_random_uuid(),sku text unique not null,title text not null,category text not null,status text not null default 'available' check(status in ('available','reserved','delivered')),created_at timestamptz not null default now());
create table public.inventory_secrets(item_id uuid primary key references public.inventory_items(id),encrypted_payload text not null check(encrypted_payload ~ '^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$'));
create table public.inventory_reservations(id uuid primary key default gen_random_uuid(),item_id uuid not null references public.inventory_items(id),order_id uuid not null references public.orders(id),reserved_by uuid not null references public.users(id),created_at timestamptz not null default now(),released_at timestamptz);
create unique index one_active_reservation on public.inventory_reservations(item_id) where released_at is null;
create table public.conversations(id uuid primary key default gen_random_uuid(),order_id uuid references public.orders(id),provider_ref text unique,status text not null default 'open',priority text not null default 'normal',updated_at timestamptz not null default now());
create table public.conversation_assignments(conversation_id uuid primary key references public.conversations(id),user_id uuid not null references public.users(id),assigned_by uuid not null references public.users(id));
create table public.internal_notes(id uuid primary key default gen_random_uuid(),order_id uuid references public.orders(id),conversation_id uuid references public.conversations(id),author_id uuid not null references public.users(id),body text not null check(length(body) between 1 and 5000),created_at timestamptz not null default now(),check(order_id is not null or conversation_id is not null));
create table public.approval_requests(id uuid primary key default gen_random_uuid(),requester_id uuid not null references public.users(id),approver_id uuid references public.users(id),action text not null check(action in ('orders.deliver','orders.cancel','orders.update_delivery','offers.delete','offers.update_price','inventory.manage')),target_id text not null,reason text not null check(length(reason) between 10 and 2000),status text not null default 'pending' check(status in ('pending','approved','rejected','executing','succeeded','failed','blocked')),idempotency_key uuid unique not null,created_at timestamptz not null default now(),decided_at timestamptz,decision_reason text,result jsonb,check(approver_id is null or approver_id<>requester_id));
create unique index one_pending_approval on public.approval_requests(action,target_id) where status in ('pending','approved','executing');
create table public.audit_logs(id uuid primary key default gen_random_uuid(),actor_id uuid references public.users(id),action text not null,target_type text not null,target_id text,metadata jsonb not null default '{}',created_at timestamptz not null default now());
create table public.integration_sync_state(provider text primary key,last_success_at timestamptz,cursor text,scope text not null default 'partial',updated_at timestamptz not null default now());
create table public.integration_errors(id uuid primary key default gen_random_uuid(),provider text not null,code text not null,created_at timestamptz not null default now());
create table public.rate_limits(key text primary key,window_start timestamptz not null default now(),hits integer not null default 1);

-- Security-definer functions have a fixed search_path and validate the verified JWT.
create function public.register_employee_session() returns boolean language plpgsql security definer set search_path=public as $$
declare sid uuid; begin
 if auth.uid() is null or not exists(select 1 from public.users where id=auth.uid() and active) then return false; end if;
 sid:=nullif(auth.jwt()->>'session_id','')::uuid;if sid is null then return false;end if;
 insert into public.employee_sessions(id,user_id) values(sid,auth.uid()) on conflict(id) do update set last_seen_at=now() where employee_sessions.user_id=auth.uid() and employee_sessions.revoked_at is null;
 return exists(select 1 from public.employee_sessions where id=sid and user_id=auth.uid() and revoked_at is null);
end $$;
create function public.staff_active() returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.users u join public.employee_sessions s on s.user_id=u.id where u.id=auth.uid() and u.active and s.id=nullif(auth.jwt()->>'session_id','')::uuid and s.revoked_at is null and (u.role not in ('OWNER','ADMIN') or auth.jwt()->>'aal'='aal2'));
$$;
create function public.has_permission(required text) returns boolean language sql stable security definer set search_path=public as $$
 select public.staff_active() and coalesce((select allowed from public.user_permission_overrides where user_id=auth.uid() and permission=required),exists(select 1 from public.role_permissions p join public.users u on u.role=p.role where u.id=auth.uid() and p.permission=required));
$$;
create function public.my_permissions() returns setof text language sql stable security definer set search_path=public as $$select name from public.permissions where public.has_permission(name)$$;
create function public.can_read_order(target uuid) returns boolean language sql stable security definer set search_path=public as $$select public.has_permission('orders.read') or (public.has_permission('orders.read_assigned') and exists(select 1 from public.order_assignments where order_id=target and user_id=auth.uid()))$$;
create function public.can_read_conversation(target uuid) returns boolean language sql stable security definer set search_path=public as $$select public.has_permission('conversations.read_all') or (public.has_permission('conversations.read') and exists(select 1 from public.conversation_assignments where conversation_id=target and user_id=auth.uid()))$$;
create function public.audit_event(event text,kind text,target text,info jsonb default '{}') returns void language sql security definer set search_path=public as $$insert into public.audit_logs(actor_id,action,target_type,target_id,metadata) values(auth.uid(),event,kind,target,info)$$;
-- audit_event is internal only: authenticated callers cannot forge audit entries.
revoke all on function public.audit_event(text,text,text,jsonb) from public;
create function public.consume_rate_limit(bucket text,max_hits integer,window_seconds integer) returns boolean language plpgsql security definer set search_path=public as $$
declare result integer;begin
 if not public.staff_active() then raise exception 'Access denied' using errcode='42501';end if;
 if bucket not in ('orders.sync','team.invite','operations.write') then raise exception 'Invalid bucket';end if;
 -- Limits are chosen in SQL, not by caller-controlled arguments.
 max_hits:=case bucket when 'orders.sync' then 20 when 'team.invite' then 10 else 30 end;window_seconds:=60;
 insert into public.rate_limits(key) values(auth.uid()::text||':'||bucket) on conflict(key) do update set hits=case when rate_limits.window_start<now()-make_interval(secs=>window_seconds) then 1 else rate_limits.hits+1 end,window_start=case when rate_limits.window_start<now()-make_interval(secs=>window_seconds) then now() else rate_limits.window_start end returning hits into result;
 return result<=max_hits;
end $$;
create function public.bootstrap_owner(owner_id uuid,owner_email text,owner_name text) returns void language plpgsql security definer set search_path=public as $$begin
 if exists(select 1 from public.users where role='OWNER') then raise exception 'Owner already exists';end if;
 insert into public.users(id,email,display_name,role) values(owner_id,owner_email,owner_name,'OWNER');
 insert into public.audit_logs(actor_id,action,target_type,target_id) values(owner_id,'owner.bootstrapped','user',owner_id::text);
end $$;
revoke all on function public.bootstrap_owner(uuid,text,text) from public;
grant execute on function public.bootstrap_owner(uuid,text,text) to service_role;
create function public.manage_staff(target uuid,new_role public.staff_role,new_active boolean,overrides jsonb) returns void language plpgsql security definer set search_path=public as $$
declare entry jsonb;begin
 if not public.has_permission('team.manage_permissions') or not exists(select 1 from public.users where id=auth.uid() and role='OWNER') then raise exception 'Access denied' using errcode='42501';end if;
 if target=auth.uid() or new_role='OWNER' or exists(select 1 from public.users where id=target and role='OWNER') then raise exception 'Owner and self changes are not allowed' using errcode='42501';end if;
 if jsonb_typeof(overrides)<>'array' then raise exception 'Invalid overrides';end if;
 update public.users set role=new_role,active=new_active where id=target;if not found then raise exception 'Staff not found';end if;
 delete from public.user_permission_overrides where user_id=target;
 for entry in select * from jsonb_array_elements(overrides) loop
 insert into public.user_permission_overrides(user_id,permission,allowed) values(target,entry->>'permission',(entry->>'allowed')::boolean);end loop;
 -- Any permission change revokes every existing session of the employee.
 update public.employee_sessions set revoked_at=now() where user_id=target and revoked_at is null;
 perform public.audit_event('staff.updated','user',target::text,jsonb_build_object('role',new_role,'active',new_active));
end $$;
create function public.revoke_staff_sessions(target uuid) returns void language plpgsql security definer set search_path=public as $$begin
 if target<>auth.uid() and not public.has_permission('team.manage_permissions') then raise exception 'Access denied' using errcode='42501';end if;
 if not public.staff_active() then raise exception 'Access denied' using errcode='42501';end if;
 update public.employee_sessions set revoked_at=now() where user_id=target;
 perform public.audit_event('sessions.revoked','user',target::text);
end $$;
create function public.assign_order(target uuid,employee uuid) returns void language plpgsql security definer set search_path=public as $$begin
 if not public.has_permission('conversations.assign') or not public.can_read_order(target) then raise exception 'Access denied' using errcode='42501';end if;
 if not exists(select 1 from public.users where id=employee and active) then raise exception 'Inactive employee';end if;
 insert into public.order_assignments(order_id,user_id,assigned_by) values(target,employee,auth.uid()) on conflict(order_id) do update set user_id=excluded.user_id,assigned_by=auth.uid(),assigned_at=now();
 perform public.audit_event('order.assigned','order',target::text,jsonb_build_object('employee',employee));
end $$;
create function public.add_internal_note(target uuid,note text) returns uuid language plpgsql security definer set search_path=public as $$declare result uuid;begin
 if not public.has_permission('conversations.internal_notes') or not public.can_read_order(target) then raise exception 'Access denied' using errcode='42501';end if;
 insert into public.internal_notes(order_id,author_id,body) values(target,auth.uid(),note) returning id into result;
 perform public.audit_event('note.created','order',target::text,jsonb_build_object('note_id',result));return result;
end $$;
create function public.request_approval(operation text,target text,justification text,request_key uuid) returns uuid language plpgsql security definer set search_path=public as $$declare result uuid;begin
 if not public.has_permission(operation) then raise exception 'Access denied' using errcode='42501';end if;
 if operation like 'orders.%' and not public.can_read_order(target::uuid) then raise exception 'Access denied' using errcode='42501';end if;
 select id into result from public.approval_requests where idempotency_key=request_key and requester_id=auth.uid() and action=operation and target_id=target and reason=justification;if result is not null then return result;end if;
 insert into public.approval_requests(requester_id,action,target_id,reason,idempotency_key) values(auth.uid(),operation,target,justification,request_key) returning id into result;
 perform public.audit_event('approval.requested','approval',result::text,jsonb_build_object('action',operation,'target',target));return result;
end $$;
create function public.decide_approval(target uuid,approve boolean,justification text) returns void language plpgsql security definer set search_path=public as $$declare approval public.approval_requests;begin
 select * into approval from public.approval_requests where id=target for update;
 if not found then raise exception 'Approval not found';end if;
 if not public.staff_active() or not public.has_permission(approval.action) or not exists(select 1 from public.users where id=auth.uid() and role in ('OWNER','ADMIN','SUPERVISOR')) or approval.requester_id=auth.uid() then raise exception 'Access denied' using errcode='42501';end if;
 if approval.status<>'pending' then raise exception 'Approval already decided';end if;
 if length(justification)<3 or length(justification)>2000 then raise exception 'Decision reason required';end if;
 update public.approval_requests set status=case when approve then 'approved' else 'rejected' end,approver_id=auth.uid(),decided_at=now(),decision_reason=justification where id=target;
 perform public.audit_event('approval.decided','approval',target::text,jsonb_build_object('approved',approve));
 -- Approval records intent only. No external operation is executed by this function.
end $$;
create function public.create_inventory(item_sku text,item_title text,item_category text,secret_ciphertext text default null) returns uuid language plpgsql security definer set search_path=public as $$declare result uuid;begin
 if not public.has_permission('inventory.manage') then raise exception 'Access denied' using errcode='42501';end if;
 if length(item_sku) not between 1 and 100 or length(item_title) not between 1 and 200 or length(item_category) not between 1 and 100 then raise exception 'Invalid item';end if;
 insert into public.inventory_items(sku,title,category) values(item_sku,item_title,item_category) returning id into result;
 if secret_ciphertext is not null then insert into public.inventory_secrets values(result,secret_ciphertext);end if;
 perform public.audit_event('inventory.created','inventory',result::text);return result;
end $$;
create function public.reserve_inventory(item uuid,target_order uuid) returns uuid language plpgsql security definer set search_path=public as $$declare result uuid;begin
 if not public.has_permission('inventory.manage') or not public.can_read_order(target_order) then raise exception 'Access denied' using errcode='42501';end if;
 perform 1 from public.inventory_items where id=item and status='available' for update;if not found then raise exception 'Item is not available';end if;
 insert into public.inventory_reservations(item_id,order_id,reserved_by) values(item,target_order,auth.uid()) returning id into result;
 update public.inventory_items set status='reserved' where id=item;
 perform public.audit_event('inventory.reserved','inventory',item::text,jsonb_build_object('order',target_order));return result;
end $$;

insert into public.permissions(name) values ('orders.read'),('orders.read_assigned'),('orders.deliver'),('orders.cancel'),('orders.update_delivery'),('offers.read'),('offers.create'),('offers.update_price'),('offers.update_stock'),('offers.pause'),('offers.delete'),('conversations.read'),('conversations.reply'),('conversations.assign'),('conversations.read_all'),('conversations.internal_notes'),('inventory.read'),('inventory.manage'),('team.read'),('team.invite'),('team.manage_permissions'),('analytics.read'),('audit.read'),('settings.manage');
insert into public.role_permissions(role,permission) values ('OWNER','orders.read'),('OWNER','orders.read_assigned'),('OWNER','orders.deliver'),('OWNER','orders.cancel'),('OWNER','orders.update_delivery'),('OWNER','offers.read'),('OWNER','offers.create'),('OWNER','offers.update_price'),('OWNER','offers.update_stock'),('OWNER','offers.pause'),('OWNER','offers.delete'),('OWNER','conversations.read'),('OWNER','conversations.reply'),('OWNER','conversations.assign'),('OWNER','conversations.read_all'),('OWNER','conversations.internal_notes'),('OWNER','inventory.read'),('OWNER','inventory.manage'),('OWNER','team.read'),('OWNER','team.invite'),('OWNER','team.manage_permissions'),('OWNER','analytics.read'),('OWNER','audit.read'),('OWNER','settings.manage'),('ADMIN','orders.read'),('ADMIN','orders.read_assigned'),('ADMIN','orders.deliver'),('ADMIN','orders.cancel'),('ADMIN','orders.update_delivery'),('ADMIN','offers.read'),('ADMIN','offers.create'),('ADMIN','offers.update_price'),('ADMIN','offers.update_stock'),('ADMIN','offers.pause'),('ADMIN','offers.delete'),('ADMIN','conversations.read'),('ADMIN','conversations.reply'),('ADMIN','conversations.assign'),('ADMIN','conversations.read_all'),('ADMIN','conversations.internal_notes'),('ADMIN','inventory.read'),('ADMIN','inventory.manage'),('ADMIN','team.read'),('ADMIN','team.invite'),('ADMIN','analytics.read'),('ADMIN','audit.read'),('SUPERVISOR','orders.read'),('SUPERVISOR','orders.deliver'),('SUPERVISOR','orders.cancel'),('SUPERVISOR','orders.update_delivery'),('SUPERVISOR','conversations.read'),('SUPERVISOR','conversations.reply'),('SUPERVISOR','conversations.assign'),('SUPERVISOR','conversations.read_all'),('SUPERVISOR','conversations.internal_notes'),('SUPERVISOR','team.read'),('SUPERVISOR','analytics.read'),('SUPPORT_AGENT','orders.read_assigned'),('SUPPORT_AGENT','conversations.read'),('SUPPORT_AGENT','conversations.reply'),('SUPPORT_AGENT','conversations.internal_notes'),('FULFILLMENT_AGENT','orders.read_assigned'),('FULFILLMENT_AGENT','orders.deliver'),('FULFILLMENT_AGENT','orders.update_delivery'),('FULFILLMENT_AGENT','inventory.read'),('VIEWER','orders.read'),('VIEWER','offers.read'),('VIEWER','inventory.read'),('VIEWER','conversations.read');
alter table public.roles enable row level security;
revoke all on public.roles from anon,authenticated;
grant all on public.roles to service_role;
alter table public.permissions enable row level security;
revoke all on public.permissions from anon,authenticated;
grant all on public.permissions to service_role;
alter table public.role_permissions enable row level security;
revoke all on public.role_permissions from anon,authenticated;
grant all on public.role_permissions to service_role;
alter table public.users enable row level security;
revoke all on public.users from anon,authenticated;
grant all on public.users to service_role;
alter table public.user_permission_overrides enable row level security;
revoke all on public.user_permission_overrides from anon,authenticated;
grant all on public.user_permission_overrides to service_role;
alter table public.employee_sessions enable row level security;
revoke all on public.employee_sessions from anon,authenticated;
grant all on public.employee_sessions to service_role;
alter table public.orders enable row level security;
revoke all on public.orders from anon,authenticated;
grant all on public.orders to service_role;
alter table public.order_state_history enable row level security;
revoke all on public.order_state_history from anon,authenticated;
grant all on public.order_state_history to service_role;
alter table public.order_assignments enable row level security;
revoke all on public.order_assignments from anon,authenticated;
grant all on public.order_assignments to service_role;
alter table public.offers enable row level security;
revoke all on public.offers from anon,authenticated;
grant all on public.offers to service_role;
alter table public.inventory_items enable row level security;
revoke all on public.inventory_items from anon,authenticated;
grant all on public.inventory_items to service_role;
alter table public.inventory_secrets enable row level security;
revoke all on public.inventory_secrets from anon,authenticated;
grant all on public.inventory_secrets to service_role;
alter table public.inventory_reservations enable row level security;
revoke all on public.inventory_reservations from anon,authenticated;
grant all on public.inventory_reservations to service_role;
alter table public.conversations enable row level security;
revoke all on public.conversations from anon,authenticated;
grant all on public.conversations to service_role;
alter table public.conversation_assignments enable row level security;
revoke all on public.conversation_assignments from anon,authenticated;
grant all on public.conversation_assignments to service_role;
alter table public.internal_notes enable row level security;
revoke all on public.internal_notes from anon,authenticated;
grant all on public.internal_notes to service_role;
alter table public.approval_requests enable row level security;
revoke all on public.approval_requests from anon,authenticated;
grant all on public.approval_requests to service_role;
alter table public.audit_logs enable row level security;
revoke all on public.audit_logs from anon,authenticated;
grant all on public.audit_logs to service_role;
alter table public.integration_sync_state enable row level security;
revoke all on public.integration_sync_state from anon,authenticated;
grant all on public.integration_sync_state to service_role;
alter table public.integration_errors enable row level security;
revoke all on public.integration_errors from anon,authenticated;
grant all on public.integration_errors to service_role;
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon,authenticated;
grant all on public.rate_limits to service_role;
grant select on public.roles to authenticated;
create policy read_access on public.roles for select to authenticated using (public.has_permission('team.read'));
grant select on public.permissions to authenticated;
create policy read_access on public.permissions for select to authenticated using (public.has_permission('team.read'));
grant select on public.role_permissions to authenticated;
create policy read_access on public.role_permissions for select to authenticated using (public.has_permission('team.read'));
grant select on public.users to authenticated;
create policy read_access on public.users for select to authenticated using (id=auth.uid() or public.has_permission('team.read'));
grant select on public.user_permission_overrides to authenticated;
create policy read_access on public.user_permission_overrides for select to authenticated using (user_id=auth.uid() or public.has_permission('team.manage_permissions'));
grant select on public.employee_sessions to authenticated;
create policy read_access on public.employee_sessions for select to authenticated using ((user_id=auth.uid() and public.staff_active()) or public.has_permission('team.manage_permissions'));
grant select on public.orders to authenticated;
create policy read_access on public.orders for select to authenticated using (public.can_read_order(id));
grant select on public.order_state_history to authenticated;
create policy read_access on public.order_state_history for select to authenticated using (public.can_read_order(order_id));
grant select on public.order_assignments to authenticated;
create policy read_access on public.order_assignments for select to authenticated using (public.can_read_order(order_id));
grant select on public.offers to authenticated;
create policy read_access on public.offers for select to authenticated using (public.has_permission('offers.read'));
grant select on public.inventory_items to authenticated;
create policy read_access on public.inventory_items for select to authenticated using (public.has_permission('inventory.read') or public.has_permission('inventory.manage'));
grant select on public.inventory_reservations to authenticated;
create policy read_access on public.inventory_reservations for select to authenticated using (public.has_permission('inventory.manage') or (public.has_permission('inventory.read') and public.can_read_order(order_id)));
grant select on public.conversations to authenticated;
create policy read_access on public.conversations for select to authenticated using (public.can_read_conversation(id));
grant select on public.conversation_assignments to authenticated;
create policy read_access on public.conversation_assignments for select to authenticated using (public.can_read_conversation(conversation_id));
grant select on public.internal_notes to authenticated;
create policy read_access on public.internal_notes for select to authenticated using (public.has_permission('conversations.internal_notes') and ((order_id is not null and public.can_read_order(order_id)) or (conversation_id is not null and public.can_read_conversation(conversation_id))));
grant select on public.approval_requests to authenticated;
create policy read_access on public.approval_requests for select to authenticated using (public.staff_active() and (requester_id=auth.uid() or (public.has_permission(action) and exists(select 1 from public.users where id=auth.uid() and role in ('OWNER','ADMIN','SUPERVISOR')))));
grant select on public.audit_logs to authenticated;
create policy read_access on public.audit_logs for select to authenticated using (public.has_permission('audit.read'));
grant select on public.integration_sync_state to authenticated;
create policy read_access on public.integration_sync_state for select to authenticated using (public.has_permission('orders.read') or public.has_permission('settings.manage'));
grant select on public.integration_errors to authenticated;
create policy read_access on public.integration_errors for select to authenticated using (public.has_permission('settings.manage'));
revoke all on function public.register_employee_session() from public;
grant execute on function public.register_employee_session() to authenticated;
revoke all on function public.staff_active() from public;
grant execute on function public.staff_active() to authenticated;
revoke all on function public.has_permission(text) from public;
grant execute on function public.has_permission(text) to authenticated;
revoke all on function public.my_permissions() from public;
grant execute on function public.my_permissions() to authenticated;
revoke all on function public.can_read_order(uuid) from public;
grant execute on function public.can_read_order(uuid) to authenticated;
revoke all on function public.can_read_conversation(uuid) from public;
grant execute on function public.can_read_conversation(uuid) to authenticated;
revoke all on function public.consume_rate_limit(text,integer,integer) from public;
grant execute on function public.consume_rate_limit(text,integer,integer) to authenticated;
revoke all on function public.manage_staff(uuid,public.staff_role,boolean,jsonb) from public;
grant execute on function public.manage_staff(uuid,public.staff_role,boolean,jsonb) to authenticated;
revoke all on function public.revoke_staff_sessions(uuid) from public;
grant execute on function public.revoke_staff_sessions(uuid) to authenticated;
revoke all on function public.assign_order(uuid,uuid) from public;
grant execute on function public.assign_order(uuid,uuid) to authenticated;
revoke all on function public.add_internal_note(uuid,text) from public;
grant execute on function public.add_internal_note(uuid,text) to authenticated;
revoke all on function public.request_approval(text,text,text,uuid) from public;
grant execute on function public.request_approval(text,text,text,uuid) to authenticated;
revoke all on function public.decide_approval(uuid,boolean,text) from public;
grant execute on function public.decide_approval(uuid,boolean,text) to authenticated;
revoke all on function public.create_inventory(text,text,text,text) from public;
grant execute on function public.create_inventory(text,text,text,text) to authenticated;
revoke all on function public.reserve_inventory(uuid,uuid) from public;
grant execute on function public.reserve_inventory(uuid,uuid) to authenticated;

-- Never store raw upstream payloads, browser cookies or access tokens. Service role is restricted to server-side sync/bootstrap.
