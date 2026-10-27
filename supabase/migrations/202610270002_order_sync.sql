-- A page and its history are committed atomically; the browser cannot execute this RPC.
create function public.persist_order_page(records jsonb,history jsonb,next_cursor text,actor uuid,actor_session uuid) returns void language plpgsql security definer set search_path=public as $$begin
 if not exists(select 1 from public.employee_sessions where id=actor_session and user_id=actor and revoked_at is null) then raise exception 'Sync session revoked' using errcode='42501';end if;
 if not exists(select 1 from public.users u where u.id=actor and u.active and coalesce((select allowed from public.user_permission_overrides where user_id=actor and permission='orders.read'),exists(select 1 from public.role_permissions where role=u.role and permission='orders.read'))) then raise exception 'Unauthorized sync actor' using errcode='42501';end if;
 insert into public.orders select * from jsonb_populate_recordset(null::public.orders,records)
 on conflict(id) do update set buyer_id=excluded.buyer_id,buyer_username=excluded.buyer_username,offer_id=excluded.offer_id,quantity=excluded.quantity,amount=excluded.amount,currency=excluded.currency,state=excluded.state,product_title=excluded.product_title,game_id=excluded.game_id,delivery_method=excluded.delivery_method,delivery_time=excluded.delivery_time,conversation_ref=excluded.conversation_ref,purchased_at=excluded.purchased_at,synced_at=excluded.synced_at,details=excluded.details;
 insert into public.order_state_history(order_id,state,occurred_at) select x.order_id,x.state,x.occurred_at from jsonb_to_recordset(history) as x(order_id uuid,state text,occurred_at timestamptz) on conflict(order_id,state,occurred_at) do nothing;
 insert into public.integration_sync_state(provider,last_success_at,cursor,scope) values('eldorado',now(),next_cursor,'partial') on conflict(provider) do update set last_success_at=now(),cursor=excluded.cursor,scope='partial',updated_at=now();
 insert into public.audit_logs(actor_id,action,target_type,metadata) values(actor,'orders.page_synced','integration',jsonb_build_object('count',jsonb_array_length(records),'scope','partial'));
end $$;
revoke all on function public.persist_order_page(jsonb,jsonb,text,uuid,uuid) from public;
grant execute on function public.persist_order_page(jsonb,jsonb,text,uuid,uuid) to service_role;
