-- Read-only upstream offer snapshots. No raw account details or upstream writes.
alter table public.offers add column if not exists source text not null default 'unknown';
alter table public.offers add column if not exists native_id text;
alter table public.offers add column if not exists game_id text;
alter table public.offers add constraint offers_source_check check(source in ('unknown','flexible','predefined','items','currency'));
create index offers_source_updated on public.offers(source,updated_at desc,id desc);

create function public.persist_offer_page(records jsonb,source_name text,page_metadata jsonb,actor uuid,actor_session uuid) returns void language plpgsql security definer set search_path=public as $$begin
 if source_name not in ('flexible','predefined','items','currency') then raise exception 'Invalid offer source';end if;
 if not exists(select 1 from public.employee_sessions where id=actor_session and user_id=actor and revoked_at is null) then raise exception 'Sync session revoked' using errcode='42501';end if;
 if not exists(select 1 from public.users u where u.id=actor and u.active and coalesce((select allowed from public.user_permission_overrides where user_id=actor and permission='offers.read'),exists(select 1 from public.role_permissions where role=u.role and permission='offers.read'))) then raise exception 'Unauthorized sync actor' using errcode='42501';end if;
 if exists(select 1 from jsonb_array_elements(records) record where record->>'source' is distinct from source_name) then raise exception 'Offer source mismatch';end if;
 insert into public.offers(id,category,title,state,price,currency,quantity,updated_at,source,native_id,game_id)
 select x.id,x.category,x.title,x.state,x.price,x.currency,x.quantity,x.updated_at,x.source,x.native_id,x.game_id from jsonb_to_recordset(records) as x(id text,category text,title text,state text,price numeric,currency text,quantity numeric,updated_at timestamptz,source text,native_id text,game_id text)
 on conflict(id) do update set category=excluded.category,title=excluded.title,state=excluded.state,price=excluded.price,currency=excluded.currency,quantity=excluded.quantity,updated_at=excluded.updated_at,source=excluded.source,native_id=excluded.native_id,game_id=excluded.game_id;
 insert into public.integration_sync_state(provider,last_success_at,cursor,scope) values('eldorado-offers:'||source_name,now(),page_metadata::text,'partial') on conflict(provider) do update set last_success_at=now(),cursor=excluded.cursor,scope='partial',updated_at=now();
 insert into public.audit_logs(actor_id,action,target_type,target_id,metadata) values(actor,'offers.page_synced','integration',source_name,jsonb_build_object('count',jsonb_array_length(records),'page',page_metadata,'upstream_write',false));
end $$;
revoke all on function public.persist_offer_page(jsonb,text,jsonb,uuid,uuid) from public;
grant execute on function public.persist_offer_page(jsonb,text,jsonb,uuid,uuid) to service_role;

create policy offer_sync_read on public.integration_sync_state for select to authenticated using(provider like 'eldorado-offers:%' and public.has_permission('offers.read'));
