-- Owner estimates are versioned price authority, never vendor-reported fees.
alter table public.repricing_policies add column economics jsonb;
alter table public.repricing_policies add column economics_context_hash text check(economics_context_hash ~ '^[a-f0-9]{64}$');
create table public.repricing_execution_validations (
 operation_id uuid primary key references public.approval_requests(id),
 quote_id uuid not null references public.repricing_quotes(id),
 evidence jsonb not null check(jsonb_typeof(evidence)='object' and pg_column_size(evidence)<65536),
 validated_at timestamptz not null default now()
);
alter table public.repricing_execution_validations enable row level security;
revoke all on public.repricing_execution_validations from public,anon,authenticated;
grant all on public.repricing_execution_validations to service_role;

create function public.repricing_economics_valid(value jsonb) returns boolean
language plpgsql stable set search_path=public as $$
declare k text; n numeric; checked timestamptz; expires timestamptz;
begin
 if value is null or jsonb_typeof(value)<>'object' or
   not (value ?& array['unitCost','feePercent','fixedFee','comparisonQuantity','minMarginPercent','verifiedAt','validUntil']) or
   (select count(*) from jsonb_object_keys(value))<>7 then return false;end if;
 foreach k in array array['unitCost','feePercent','fixedFee','comparisonQuantity','minMarginPercent'] loop
  if jsonb_typeof(value->k)<>'number' then return false;end if;
  n:=(value->>k)::numeric;
  if n<0 or n>1000000000000 then return false;end if;
 end loop;
 n:=(value->>'comparisonQuantity')::numeric;
 if n<1 or n>2147483647 or n<>trunc(n) or (value->>'feePercent')::numeric>99.99 or (value->>'minMarginPercent')::numeric>99.99 or
   (value->>'feePercent')::numeric+(value->>'minMarginPercent')::numeric>=100 then return false;end if;
 if jsonb_typeof(value->'verifiedAt')<>'string' or jsonb_typeof(value->'validUntil')<>'string' then return false;end if;
 checked:=(value->>'verifiedAt')::timestamptz;expires:=(value->>'validUntil')::timestamptz;
 return checked<=now()+interval '5 seconds' and expires>now() and expires>checked and expires<=checked+interval '30 days';
exception when others then return false;
end $$;

create function public.repricing_effective_floor(policy public.repricing_policies) returns numeric
language sql stable set search_path=public as $$
 select case when public.repricing_economics_valid(policy.economics) then greatest(policy.floor,
  ((policy.economics->>'unitCost')::numeric+(policy.economics->>'fixedFee')::numeric/(policy.economics->>'comparisonQuantity')::numeric)
  /(1-(policy.economics->>'feePercent')::numeric/100-(policy.economics->>'minMarginPercent')::numeric/100)) else policy.floor end
$$;

-- The same financial floor covers direct/manual price, full-detail and batch
-- tickets; choosing another screen must not bypass a configured margin.
create or replace function public.enforce_marketplace_floor() returns trigger language plpgsql security definer set search_path=public as $$
declare policy public.repricing_policies;kind text;price_body jsonb;
begin
 if new.payload->>'marketV1' is distinct from 'true' or new.status not in ('pending','approved','executing','blocked') then return new;end if;
 kind:=new.payload->'change'->>'kind';
 if kind not in ('offer.price','offer.details') then return new;end if;
 select * into policy from public.repricing_policies where native_id::text=lower(new.payload->>'nativeId');
 if not found then return new;end if;
 if policy.economics is not null and not public.repricing_economics_valid(policy.economics) then
  raise exception 'Refresh the configured cost and fee estimates before changing this price' using errcode='22023';end if;
 price_body:=case kind when 'offer.price' then new.payload->'change'->'body' else new.payload->'change'->'body'->'details'->'pricing'->'pricePerUnit' end;
 if price_body->>'currency' is distinct from policy.currency or (price_body->>'amount')::numeric<public.repricing_effective_floor(policy) then
  raise exception 'The requested price violates the configured currency, floor or minimum margin' using errcode='22023';end if;
 if kind='offer.details' and policy.economics is not null and (
  new.payload->'change'->'body'->'details'->'pricing'->'minQuantity' is distinct from new.payload->'before'->'details'->'pricing'->'minQuantity' or
  new.payload->'change'->'body'->'details'->'pricing'->'volumeDiscounts' is distinct from '[]'::jsonb or
  new.payload->'change'->'body'->'augmentedGame'->>'gameId' is distinct from new.payload->'before'->>'gameId' or
  new.payload->'change'->'body'->'augmentedGame'->>'category' is distinct from new.payload->'before'->>'category') then
  raise exception 'Quantity tiers or product changes require a new cost review; remove or refresh economic authority first' using errcode='22023';end if;
 return new;
end $$;

-- Preserve the mature permission/locking implementation behind an inaccessible
-- internal function. The public RPC always versions assumptions in the same tx.
alter function public.save_repricing_policy(text,numeric,numeric,integer,text,integer,boolean) rename to save_repricing_policy_base;
revoke all on function public.save_repricing_policy_base(text,numeric,numeric,integer,text,integer,boolean) from public,anon,authenticated,service_role;
create function public.save_repricing_policy(target text,desired_floor numeric,desired_difference numeric,desired_decimals integer,desired_mode text,seconds integer,activation_confirmed boolean,desired_economics jsonb default null,desired_context_hash text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 if desired_economics is not null and not public.repricing_economics_valid(desired_economics) then
  raise exception 'Provide complete, current economics in the listing currency with a viable margin' using errcode='22023';end if;
 result:=public.save_repricing_policy_base(target,desired_floor,desired_difference,desired_decimals,desired_mode,seconds,activation_confirmed);
 update public.repricing_policies set economics=desired_economics,economics_context_hash=case when desired_economics is not null then desired_context_hash end where id=(result->>'id')::uuid;
 perform public.audit_event('repricing.economics_saved','repricing_policy',result->>'id',jsonb_build_object('version',result->>'version','source','owner-estimate','economics',desired_economics));
 return result||jsonb_build_object('economics',desired_economics,'economics_context_hash',desired_context_hash);
end $$;

-- Existing automatic policies without current economics cannot execute.
create or replace function public.automatic_policy_authorized(policy_id uuid,expected_version uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.repricing_policies p join public.workspace_preferences w on w.id
  join public.offers o on o.id=p.offer_id
  where p.id=policy_id and p.version=expected_version and p.mode='automatic' and p.review_status='approved'
   and w.auto_pricing_enabled and p.approved_by is not null and p.approved_by<>p.created_by
   and exists(select 1 from public.users where id=p.created_by and role='OWNER' and active)
   and exists(select 1 from public.users where id=p.approved_by and role in ('OWNER','ADMIN','SUPERVISOR') and active)
   and public.market_user_authorized(p.created_by,'offers.read') and public.market_user_authorized(p.created_by,'offers.update_price')
   and public.market_user_authorized(p.approved_by,'offers.read') and public.market_user_authorized(p.approved_by,'offers.update_price')
   and public.repricing_economics_valid(p.economics) and p.economics_context_hash is not null and o.category<>'TopUp')
$$;

create function public.assert_repricing_proof(policy public.repricing_policies,quote public.repricing_quotes,evidence jsonb) returns void
language plpgsql stable set search_path=public as $$
declare started timestamptz; observed timestamptz; expires timestamptz;
begin
 if quote.id is null or policy.id is null or quote.expires_at<=now() or quote.policy_version<>policy.version or
  quote.currency<>policy.currency or not public.repricing_economics_valid(policy.economics) or
  quote.amount<public.repricing_effective_floor(policy) or evidence->>'complete' is distinct from 'true' or
  evidence->>'executable' is distinct from 'true' or evidence->>'policyVersion' is distinct from policy.version::text then
  raise exception 'Current margin-protected simulation required' using errcode='22023';end if;
 if policy.economics_context_hash is null or evidence->>'contextHash' is distinct from policy.economics_context_hash then
  raise exception 'Product identity changed since cost verification' using errcode='22023';end if;
 started:=nullif(evidence->>'collectionStartedAt','')::timestamptz;
 observed:=nullif(evidence->>'observedAt','')::timestamptz;
 expires:=nullif(evidence->>'validUntil','')::timestamptz;
 if started is null or observed is null or expires is null or started>observed or observed>now()+interval '5 seconds' or
  started>now()+interval '5 seconds' or expires<=now() or expires>started+interval '60 seconds' or
  observed-started>interval '60 seconds' or expires>(policy.economics->>'validUntil')::timestamptz then
  raise exception 'Market observation is expired or incomplete' using errcode='22023';end if;
 if exists(select 1 from public.offers where id=policy.offer_id and category='TopUp') then
  raise exception 'Authoritative top-up equivalence is not configured' using errcode='22023';end if;
end $$;

create function public.guard_quoted_repricing() returns trigger language plpgsql security definer set search_path=public as $$
declare quote public.repricing_quotes;policy public.repricing_policies;fresh_evidence jsonb;
begin
 if new.repricing_quote_id is null or new.status not in ('pending','approved','executing') then return new;end if;
 if tg_op='UPDATE' and new.repricing_quote_id is not distinct from old.repricing_quote_id and new.status is not distinct from old.status then return new;end if;
 select * into quote from public.repricing_quotes where id=new.repricing_quote_id;
 select * into policy from public.repricing_policies where id=quote.policy_id;
 if new.target_id is distinct from policy.offer_id or new.payload->'change'->>'kind' is distinct from 'offer.price' or
  (new.payload->'change'->'body'->>'amount')::numeric is distinct from quote.amount or new.payload->'change'->'body'->>'currency' is distinct from quote.currency then
  raise exception 'Quoted operation target or amount changed' using errcode='22023';end if;
 if new.status='executing' then
  select evidence into fresh_evidence from public.repricing_execution_validations where operation_id=new.id and quote_id=quote.id;
 else fresh_evidence:=quote.proof;end if;
 perform public.assert_repricing_proof(policy,quote,fresh_evidence);
 return new;
end $$;
create trigger guard_quoted_repricing before insert or update on public.approval_requests for each row execute function public.guard_quoted_repricing();

create function public.record_repricing_validation(operation_id uuid,quote_id uuid,evidence jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare ticket public.approval_requests;quote public.repricing_quotes;policy public.repricing_policies;
begin
 select * into ticket from public.approval_requests where id=operation_id for update;
 select * into quote from public.repricing_quotes where id=quote_id;
 select * into policy from public.repricing_policies where id=quote.policy_id;
 if ticket.id is null or ticket.repricing_quote_id is distinct from quote_id or ticket.status<>'approved' or ticket.external_attempted then
  raise exception 'Approved unclaimed quote required' using errcode='55000';end if;
 perform public.assert_repricing_proof(policy,quote,evidence);
 insert into public.repricing_execution_validations(operation_id,quote_id,evidence) values(operation_id,quote_id,evidence)
 on conflict on constraint repricing_execution_validations_pkey do update set quote_id=excluded.quote_id,evidence=excluded.evidence,validated_at=now();
 insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
 values(ticket.requester_id,'repricing.market_revalidated','approval',operation_id::text,jsonb_build_object('quote',quote_id,'evidence',evidence));
end $$;

-- Only trusted server code records refreshed market evidence. Browser roles
-- retain SELECT-only table access and cannot manufacture financial approval.
create function public.assert_claimed_marketplace_authority(operation_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare ticket public.approval_requests;required text;
begin
 select * into ticket from public.approval_requests where id=operation_id;
 if ticket.id is null or ticket.payload->>'marketV1' is distinct from 'true' or ticket.status<>'executing' or
  not ticket.external_attempted or auth.jwt()->>'aal' is distinct from 'aal2' or not public.has_permission(ticket.action) or
  auth.uid() not in (ticket.requester_id,ticket.approver_id) or ticket.approver_id is null or ticket.requester_id=ticket.approver_id or
  ticket.payload->>'automaticPolicyId' is not null or
  not public.market_user_authorized(ticket.requester_id,ticket.action) or not public.market_user_authorized(ticket.approver_id,ticket.action) or
  not exists(select 1 from public.users where id=ticket.approver_id and active and role in ('OWNER','ADMIN','SUPERVISOR')) then
  raise exception 'Current MFA and independent operation authority required' using errcode='42501';end if;
 if (ticket.action like 'orders.%' and not public.can_read_order(ticket.target_id::uuid)) or
  (ticket.action like 'offers.%' and (not public.has_permission('offers.read') or not public.market_user_authorized(ticket.requester_id,'offers.read') or not public.market_user_authorized(ticket.approver_id,'offers.read'))) then
  raise exception 'Current target access required' using errcode='42501';end if;
 if ticket.payload->'change'->>'kind'='offer.details' then
  foreach required in array array['offers.update_price','offers.update_stock'] loop
   if not public.has_permission(required) or not public.market_user_authorized(ticket.requester_id,required) or not public.market_user_authorized(ticket.approver_id,required) then
    raise exception 'Details require current price and stock authority' using errcode='42501';end if;
  end loop;
 end if;
end $$;

revoke all on function public.repricing_economics_valid(jsonb),public.repricing_effective_floor(public.repricing_policies),public.save_repricing_policy(text,numeric,numeric,integer,text,integer,boolean,jsonb,text),public.automatic_policy_authorized(uuid,uuid),public.assert_repricing_proof(public.repricing_policies,public.repricing_quotes,jsonb),public.guard_quoted_repricing(),public.record_repricing_validation(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_repricing_policy(text,numeric,numeric,integer,text,integer,boolean,jsonb,text) to authenticated;
grant execute on function public.automatic_policy_authorized(uuid,uuid),public.record_repricing_validation(uuid,uuid,jsonb) to service_role;
revoke all on function public.assert_claimed_marketplace_authority(uuid) from public,anon,authenticated;
grant execute on function public.assert_claimed_marketplace_authority(uuid) to authenticated;
