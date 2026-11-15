-- Keep catalog delivery promises and minimum quantities aligned with a verified
-- details edit, including reconciliation after an uncertain upstream response.
-- This only refreshes local metadata; it never calls the marketplace.
create function public.refresh_verified_catalog_details() returns trigger
language plpgsql security definer set search_path=public as $$
declare document jsonb:=new.result->'document';
begin
 if new.status<>'succeeded' or old.status='succeeded' or new.payload->'change'->>'kind' is distinct from 'offer.details'
  or new.result->>'verified' is distinct from 'true' or document is distinct from new.payload->'change'->'body' then return new;end if;
 update public.offers set
  game_category_title=case when game_id is not distinct from document->'augmentedGame'->>'gameId' then game_category_title end,
  catalog_region=case when game_id is not distinct from document->'augmentedGame'->>'gameId' and category is not distinct from document->'augmentedGame'->>'category' then catalog_region end,
  catalog_platform=case when game_id is not distinct from document->'augmentedGame'->>'gameId' and category is not distinct from document->'augmentedGame'->>'category' then catalog_platform end,
  catalog_denomination=case when game_id is not distinct from document->'augmentedGame'->>'gameId' and category is not distinct from document->'augmentedGame'->>'category' then catalog_denomination end,
  game_id=document->'augmentedGame'->>'gameId',category=document->'augmentedGame'->>'category',
  min_quantity=(document->'details'->'pricing'->>'minQuantity')::numeric,
  delivery_time=document->'details'->>'guaranteedDeliveryTime',delivery_method=document->'details'->>'deliveryMethod',
  unit_system=case when jsonb_typeof(new.result->'context'->'unitSystem')='string' then left(new.result->'context'->>'unitSystem',100) end,
  -- Re-read attribute labels through the public-field sanitizer on the next
  -- catalog sync. A details write must not leave an old attribute label visible.
  public_context='{"attributes":[],"tradeEnvironmentValues":[],"offerAttributeIdValues":[]}'::jsonb
 where lower(native_id)=lower(new.payload->>'nativeId');
 insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
 values(new.requester_id,'offers.catalog_verified_details','offer',new.target_id,jsonb_build_object('operation',new.id,'upstream_write',false));
 return new;
end $$;
create trigger verified_catalog_details after update of status on public.approval_requests
for each row execute function public.refresh_verified_catalog_details();
revoke all on function public.refresh_verified_catalog_details() from public,anon,authenticated;
