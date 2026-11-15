-- Public operational fields only. Local tags organize this workspace; they do
-- not alter Eldorado attributes and must never certify repricing equivalence.
alter table public.offers
 add column game_category_title text,
 add column min_quantity numeric check(min_quantity is null or min_quantity>=0),
 add column unit_system text,
 add column delivery_time text,
 add column delivery_method text,
 add column public_context jsonb not null default '{"attributes":[],"tradeEnvironmentValues":[],"offerAttributeIdValues":[]}'::jsonb check(jsonb_typeof(public_context)='object' and pg_column_size(public_context)<131072),
 add column catalog_region text check(length(catalog_region)<=100),
 add column catalog_platform text check(length(catalog_platform)<=100),
 add column catalog_denomination text check(length(catalog_denomination)<=100),
 add column catalog_tagged_at timestamptz,
 add column catalog_search text generated always as (
  coalesce(title,'')||' '||coalesce(native_id,'')||' '||coalesce(game_id,'')||' '||coalesce(game_category_title,'')||' '||coalesce(catalog_region,'')||' '||coalesce(catalog_platform,'')||' '||coalesce(catalog_denomination,'')
 ) stored;
create index offers_category_game on public.offers(category,game_id,updated_at desc,id desc);
create index offers_catalog_region on public.offers(catalog_region) where catalog_region is not null;
create index offers_catalog_platform on public.offers(catalog_platform) where catalog_platform is not null;
create index offers_catalog_denomination on public.offers(catalog_denomination) where catalog_denomination is not null;
create index offers_delivery_time on public.offers(delivery_time) where delivery_time is not null;

create or replace function public.persist_offer_page(records jsonb,source_name text,page_metadata jsonb,actor uuid,actor_session uuid) returns void language plpgsql security definer set search_path=public as $$begin
 if source_name not in ('flexible','predefined','items','currency') then raise exception 'Invalid offer source';end if;
 if not exists(select 1 from public.employee_sessions where id=actor_session and user_id=actor and revoked_at is null) then raise exception 'Sync session revoked' using errcode='42501';end if;
 if not exists(select 1 from public.users u where u.id=actor and u.active and coalesce((select allowed from public.user_permission_overrides where user_id=actor and permission='offers.read'),exists(select 1 from public.role_permissions where role=u.role and permission='offers.read'))) then raise exception 'Unauthorized sync actor' using errcode='42501';end if;
 if exists(select 1 from jsonb_array_elements(records) record where record->>'source' is distinct from source_name) then raise exception 'Offer source mismatch';end if;
 insert into public.offers(id,category,title,state,price,currency,quantity,updated_at,source,native_id,game_id,game_category_title,min_quantity,unit_system,delivery_time,delivery_method,public_context)
 select x.id,x.category,x.title,x.state,x.price,x.currency,x.quantity,x.updated_at,x.source,x.native_id,x.game_id,x.game_category_title,x.min_quantity,x.unit_system,x.delivery_time,x.delivery_method,coalesce(x.public_context,'{"attributes":[],"tradeEnvironmentValues":[],"offerAttributeIdValues":[]}'::jsonb)
 from jsonb_to_recordset(records) as x(id text,category text,title text,state text,price numeric,currency text,quantity numeric,updated_at timestamptz,source text,native_id text,game_id text,game_category_title text,min_quantity numeric,unit_system text,delivery_time text,delivery_method text,public_context jsonb)
 on conflict(id) do update set category=excluded.category,title=excluded.title,state=excluded.state,price=excluded.price,currency=excluded.currency,quantity=excluded.quantity,updated_at=excluded.updated_at,source=excluded.source,native_id=excluded.native_id,game_id=excluded.game_id,game_category_title=excluded.game_category_title,min_quantity=excluded.min_quantity,unit_system=excluded.unit_system,delivery_time=excluded.delivery_time,delivery_method=excluded.delivery_method,public_context=excluded.public_context;
 insert into public.integration_sync_state(provider,last_success_at,cursor,scope) values('eldorado-offers:'||source_name,now(),page_metadata::text,'partial') on conflict(provider) do update set last_success_at=now(),cursor=excluded.cursor,scope='partial',updated_at=now();
 insert into public.audit_logs(actor_id,action,target_type,target_id,metadata) values(actor,'offers.page_synced','integration',source_name,jsonb_build_object('count',jsonb_array_length(records),'page',page_metadata,'upstream_write',false));
end $$;
revoke all on function public.persist_offer_page(jsonb,text,jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function public.persist_offer_page(jsonb,text,jsonb,uuid,uuid) to service_role;

create function public.save_offer_catalog_tags(offer_id text,region text,platform text,denomination text) returns void language plpgsql security definer set search_path=public as $$begin
 if not public.has_permission('offers.read') or not public.has_permission('offers.create') or auth.jwt()->>'aal' is distinct from 'aal2' then raise exception 'Catalog editing permission and MFA required' using errcode='42501';end if;
 if region is null or platform is null or denomination is null or greatest(length(region),length(platform),length(denomination))>100 then raise exception 'Invalid catalog labels';end if;
 update public.offers set catalog_region=nullif(btrim(region),''),catalog_platform=nullif(btrim(platform),''),catalog_denomination=nullif(btrim(denomination),''),catalog_tagged_at=now() where id=offer_id;
 if not found then raise exception 'Synchronized listing not found';end if;
 perform public.audit_event('offers.catalog_labels_saved','offer',offer_id,jsonb_build_object('region',nullif(btrim(region),''),'platform',nullif(btrim(platform),''),'denomination',nullif(btrim(denomination),''),'scope','local_only','upstream_write',false));
end $$;
revoke all on function public.save_offer_catalog_tags(text,text,text,text) from public,anon,authenticated;
grant execute on function public.save_offer_catalog_tags(text,text,text,text) to authenticated;

-- Invoker security keeps the existing offers RLS policy authoritative. Facets
-- describe the synchronized local catalog, not undocumented upstream filters.
create function public.offer_catalog_facets() returns jsonb language plpgsql stable set search_path=public as $$begin
 if not public.has_permission('offers.read') then raise exception 'Listing access required' using errcode='42501';end if;
 return jsonb_build_object(
  'categories',(select coalesce(jsonb_agg(value order by value),'[]'::jsonb) from (select distinct category as value from public.offers order by category limit 200) q),
  'games',(select coalesce(jsonb_agg(value order by value),'[]'::jsonb) from (select distinct game_id as value from public.offers where game_id is not null order by game_id limit 200) q),
  'states',(select coalesce(jsonb_agg(value order by value),'[]'::jsonb) from (select distinct state as value from public.offers order by state limit 200) q),
  'regions',(select coalesce(jsonb_agg(value order by value),'[]'::jsonb) from (select distinct catalog_region as value from public.offers where catalog_region is not null order by catalog_region limit 200) q),
  'platforms',(select coalesce(jsonb_agg(value order by value),'[]'::jsonb) from (select distinct catalog_platform as value from public.offers where catalog_platform is not null order by catalog_platform limit 200) q),
  'denominations',(select coalesce(jsonb_agg(value order by value),'[]'::jsonb) from (select distinct catalog_denomination as value from public.offers where catalog_denomination is not null order by catalog_denomination limit 200) q)
 );
end $$;
revoke all on function public.offer_catalog_facets() from public,anon,authenticated;
grant execute on function public.offer_catalog_facets() to authenticated;
