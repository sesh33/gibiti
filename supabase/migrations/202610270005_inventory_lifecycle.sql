insert into public.permissions(name) values('inventory.secrets.read');
insert into public.role_permissions(role,permission) values('OWNER','inventory.secrets.read');
create table public.inventory_movements(id uuid primary key default gen_random_uuid(),item_id uuid not null references public.inventory_items(id),actor_id uuid references public.users(id),from_status text,to_status text not null,created_at timestamptz not null default now());
alter table public.inventory_movements enable row level security;
revoke all on public.inventory_movements from anon,authenticated;
grant all on public.inventory_movements to service_role;
grant select on public.inventory_movements to authenticated;
create policy read_access on public.inventory_movements for select to authenticated using(public.has_permission('inventory.manage'));
create function public.record_inventory_movement() returns trigger language plpgsql security definer set search_path=public as $$begin
 insert into public.inventory_movements(item_id,actor_id,from_status,to_status) values(new.id,auth.uid(),case when tg_op='INSERT' then null else old.status end,new.status);
 return new;
end $$;
revoke all on function public.record_inventory_movement() from public;
create trigger inventory_movement_insert after insert on public.inventory_items for each row execute function public.record_inventory_movement();
create trigger inventory_movement_update after update of status on public.inventory_items for each row when(old.status is distinct from new.status) execute function public.record_inventory_movement();
drop policy read_access on public.inventory_items;
create policy read_access on public.inventory_items for select to authenticated using(public.has_permission('inventory.manage') or (public.has_permission('inventory.read') and (public.has_permission('orders.read') or exists(select 1 from public.inventory_reservations where item_id=inventory_items.id and released_at is null and public.can_read_order(order_id)))));
create function public.finish_inventory_reservation(reservation uuid,consume boolean,justification text) returns void language plpgsql security definer set search_path=public as $$declare target public.inventory_reservations;begin
 if not public.has_permission('inventory.manage') then raise exception 'Access denied' using errcode='42501';end if;
 if consume then raise exception 'Critical consumption requires approval';end if;
 if length(justification) not between 3 and 2000 then raise exception 'Reason required';end if;
 select * into target from public.inventory_reservations where id=reservation for update;
 if not found or target.released_at is not null or not public.can_read_order(target.order_id) then raise exception 'Reservation unavailable';end if;
 perform 1 from public.inventory_items where id=target.item_id and status='reserved' for update;if not found then raise exception 'Inventory state changed';end if;
 update public.inventory_reservations set released_at=now() where id=reservation;
 update public.inventory_items set status=case when consume then 'delivered' else 'available' end where id=target.item_id;
 perform public.audit_event(case when consume then 'inventory.consumed' else 'inventory.released' end,'inventory',target.item_id::text,jsonb_build_object('order',target.order_id,'reservation',reservation,'reason',justification));
 -- This records internal stock movement only. It never changes the Eldorado order.
end $$;
revoke all on function public.finish_inventory_reservation(uuid,boolean,text) from public;
grant execute on function public.finish_inventory_reservation(uuid,boolean,text) to authenticated;
create function public.access_inventory_secret(item uuid) returns text language plpgsql security definer set search_path=public as $$declare ciphertext text;begin
 if not public.has_permission('inventory.secrets.read') then raise exception 'Access denied' using errcode='42501';end if;
 if not public.has_permission('inventory.manage') and not exists(select 1 from public.inventory_reservations where item_id=item and released_at is null and public.can_read_order(order_id)) then raise exception 'Item is not assigned' using errcode='42501';end if;
 select encrypted_payload into ciphertext from public.inventory_secrets where item_id=item;if not found then raise exception 'No delivery data exists';end if;
 perform public.audit_event('inventory.secret_accessed','inventory',item::text);return ciphertext;
end $$;
revoke all on function public.access_inventory_secret(uuid) from public;
grant execute on function public.access_inventory_secret(uuid) to authenticated;
-- Critical consumption is requested separately and must be reviewed; the public finish path releases only.
create function public.request_inventory_consumption(reservation uuid,justification text,request_key uuid) returns uuid language plpgsql security definer set search_path=public as $$declare target public.inventory_reservations;result uuid;begin
 if not public.has_permission('inventory.manage') then raise exception 'Access denied' using errcode='42501';end if;
 select * into target from public.inventory_reservations where id=reservation and released_at is null;
 if not found or not public.can_read_order(target.order_id) then raise exception 'Reservation unavailable';end if;
 select id into result from public.approval_requests where idempotency_key=request_key and requester_id=auth.uid() and action='inventory.manage' and target_id=target.item_id::text and reason=justification and payload=jsonb_build_object('operation','consume','reservation',reservation);if result is not null then return result;end if;
 insert into public.approval_requests(requester_id,action,target_id,reason,idempotency_key,payload) values(auth.uid(),'inventory.manage',target.item_id::text,justification,request_key,jsonb_build_object('operation','consume','reservation',reservation)) returning id into result;
 perform public.audit_event('inventory.consumption_requested','inventory',target.item_id::text,jsonb_build_object('approval_id',result));return result;
end $$;
revoke all on function public.request_inventory_consumption(uuid,text,uuid) from public;
grant execute on function public.request_inventory_consumption(uuid,text,uuid) to authenticated;
