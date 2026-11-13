-- Durable settings and price authority. All automation starts disabled.
create table public.workspace_preferences (
 id boolean primary key default true check(id),poll_enabled boolean not null default false,
 poll_seconds integer not null default 60 check(poll_seconds between 60 and 86400),
 auto_delivery_enabled boolean not null default false,auto_pricing_enabled boolean not null default false,updated_by uuid references public.users(id),updated_at timestamptz not null default now()
);
insert into public.workspace_preferences(id) values(true);
create table public.staff_preferences (
 user_id uuid primary key references public.users(id),order_poll_enabled boolean not null default false,
 order_poll_seconds integer not null default 60 check(order_poll_seconds between 30 and 86400),updated_at timestamptz not null default now()
);
create table public.repricing_policies (
 id uuid primary key default gen_random_uuid(),offer_id text unique not null references public.offers(id),
 native_id uuid not null unique,currency text not null check(currency ~ '^[A-Z]{3}$'),
 floor numeric not null check(floor>0),difference numeric not null default 0 check(difference>=0),
 decimals integer not null default 2 check(decimals between 0 and 8),
 mode text not null default 'simulation' check(mode in ('simulation','manual','automatic')),
 interval_seconds integer not null default 300 check(interval_seconds between 60 and 86400),
 version uuid not null default gen_random_uuid(),created_by uuid not null references public.users(id),
 approved_by uuid references public.users(id),review_status text not null default 'not_required' check(review_status in ('not_required','pending','approved','rejected')),
 review_reason text,reviewed_at timestamptz,last_checked_at timestamptz,next_run_at timestamptz not null default now(),
 last_error_code text,updated_at timestamptz not null default now(),check(approved_by is null or approved_by<>created_by)
);
create table public.repricing_quotes (
 id uuid primary key default gen_random_uuid(),policy_id uuid not null references public.repricing_policies(id),
 policy_version uuid not null,requested_by uuid not null references public.users(id),
 amount numeric not null check(amount>0),currency text not null,before_snapshot jsonb not null,proof jsonb not null,
 created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '2 minutes'
);
alter table public.approval_requests add column repricing_quote_id uuid references public.repricing_quotes(id);
alter table public.approval_requests add column automatic_delivery_requested boolean not null default false;
alter table public.approval_requests add column fulfillment_confirmed_at timestamptz;
alter table public.workspace_preferences enable row level security;
alter table public.staff_preferences enable row level security;
alter table public.repricing_policies enable row level security;
alter table public.repricing_quotes enable row level security;
revoke all on public.workspace_preferences,public.staff_preferences,public.repricing_policies,public.repricing_quotes from public,anon,authenticated;
grant select on public.workspace_preferences,public.staff_preferences,public.repricing_policies,public.repricing_quotes to authenticated;
grant all on public.workspace_preferences,public.staff_preferences,public.repricing_policies,public.repricing_quotes to service_role;
create policy workspace_preferences_read on public.workspace_preferences for select to authenticated using(public.staff_active());
create policy staff_preferences_read on public.staff_preferences for select to authenticated using(user_id=auth.uid() and public.staff_active());
create policy repricing_policies_read on public.repricing_policies for select to authenticated using(public.has_permission('offers.read') and public.has_permission('offers.update_price'));
create policy repricing_quotes_read on public.repricing_quotes for select to authenticated using(public.has_permission('offers.read') and public.has_permission('offers.update_price') and (requested_by=auth.uid() or public.has_permission('audit.read')));

create function public.save_staff_preferences(enabled boolean,seconds integer) returns jsonb language plpgsql security definer set search_path=public as $$
declare result public.staff_preferences;
begin
 if not public.staff_active() or (enabled and not public.has_permission('orders.read')) then raise exception 'Polling permission required' using errcode='42501';end if;
 insert into public.staff_preferences(user_id,order_poll_enabled,order_poll_seconds) values(auth.uid(),enabled,seconds)
 on conflict(user_id) do update set order_poll_enabled=excluded.order_poll_enabled,order_poll_seconds=excluded.order_poll_seconds,updated_at=now() returning * into result;
 return to_jsonb(result);
end $$;

create function public.save_repricing_policy(target text,desired_floor numeric,desired_difference numeric,desired_decimals integer,desired_mode text,seconds integer,activation_confirmed boolean)
 returns jsonb language plpgsql security definer set search_path=public as $$
declare listing public.offers;result public.repricing_policies;
begin
 if not public.has_permission('settings.manage') or auth.jwt()->>'aal' is distinct from 'aal2'
  or not exists(select 1 from public.users where id=auth.uid() and role='OWNER' and active) then raise exception 'MFA Owner required' using errcode='42501';end if;
 select * into listing from public.offers where id=target and source='predefined';
 if not found or listing.currency is null then raise exception 'Synchronize a predefined offer first';end if;
 perform pg_advisory_xact_lock(hashtextextended('offer:'||lower(listing.native_id),916));
 if exists(select 1 from public.approval_requests where payload->>'lockKey'='offer:'||lower(listing.native_id) and status in ('executing','blocked'))
  or exists(select 1 from public.offer_availability_operations where lower(native_id)=lower(listing.native_id) and status in ('running','unknown')) then
  raise exception 'Resolve the in-flight operation before changing its price authority' using errcode='55000';end if;
 if desired_mode='automatic' and activation_confirmed is distinct from true then raise exception 'Explicit automatic activation required';end if;
 insert into public.repricing_policies(offer_id,native_id,currency,floor,difference,decimals,mode,interval_seconds,created_by,review_status)
 values(listing.id,listing.native_id::uuid,listing.currency,desired_floor,desired_difference,desired_decimals,desired_mode,seconds,auth.uid(),case when desired_mode='automatic' then 'pending' else 'not_required' end)
 on conflict(offer_id) do update set currency=excluded.currency,floor=excluded.floor,difference=excluded.difference,decimals=excluded.decimals,mode=excluded.mode,
  interval_seconds=excluded.interval_seconds,version=gen_random_uuid(),created_by=auth.uid(),approved_by=null,review_status=excluded.review_status,
  review_reason=null,reviewed_at=null,next_run_at=now(),last_error_code=null,updated_at=now() returning * into result;
 perform public.audit_event('repricing.policy_saved','repricing_policy',result.id::text,jsonb_build_object('mode',result.mode,'version',result.version,'floor',result.floor,'currency',result.currency));
 return to_jsonb(result);
end $$;

create function public.review_repricing_policy(target uuid,expected_version uuid,approve boolean,justification text) returns jsonb language plpgsql security definer set search_path=public as $$
declare result public.repricing_policies;
begin
 select * into result from public.repricing_policies where id=target for update;
 if not found or result.version<>expected_version or result.mode<>'automatic' or result.review_status<>'pending' then raise exception 'Policy changed or already reviewed';end if;
 if not public.has_permission('offers.update_price') or not public.has_permission('offers.read') or auth.jwt()->>'aal' is distinct from 'aal2'
  or result.created_by=auth.uid() or not exists(select 1 from public.users where id=auth.uid() and role in ('OWNER','ADMIN','SUPERVISOR')) then raise exception 'Independent MFA reviewer required' using errcode='42501';end if;
 if length(btrim(justification)) not between 3 and 2000 then raise exception 'Review reason required';end if;
 update public.repricing_policies set approved_by=auth.uid(),review_status=case when approve then 'approved' else 'rejected' end,review_reason=btrim(justification),reviewed_at=now(),next_run_at=now() where id=target returning * into result;
 perform public.audit_event('repricing.policy_reviewed','repricing_policy',result.id::text,jsonb_build_object('approved',approve,'version',result.version));
 return to_jsonb(result);
end $$;

create function public.enforce_marketplace_floor() returns trigger language plpgsql security definer set search_path=public as $$
declare policy public.repricing_policies;kind text;price_body jsonb;
begin
 if new.payload->>'marketV1' is distinct from 'true' or new.status not in ('pending','approved','executing','blocked') then return new;end if;
 kind:=new.payload->'change'->>'kind';
 if kind not in ('offer.price','offer.details') then return new;end if;
 select * into policy from public.repricing_policies where native_id::text=lower(new.payload->>'nativeId');
 if not found then return new;end if;
 price_body:=case kind when 'offer.price' then new.payload->'change'->'body' else new.payload->'change'->'body'->'details'->'pricing'->'pricePerUnit' end;
 if price_body->>'currency' is distinct from policy.currency or (price_body->>'amount')::numeric<policy.floor then
  raise exception 'The requested price violates the configured currency or floor' using errcode='22023';end if;
 return new;
end $$;
create trigger marketplace_floor before insert or update on public.approval_requests for each row execute function public.enforce_marketplace_floor();

create function public.request_quoted_repricing(quote_id uuid,justification text,request_key uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare quote public.repricing_quotes;policy public.repricing_policies;listing public.offers;ticket uuid;
begin
 if not public.has_permission('offers.update_price') or not public.has_permission('offers.read') then raise exception 'Price permission required' using errcode='42501';end if;
 select id into ticket from public.approval_requests where idempotency_key=request_key and requester_id=auth.uid() and repricing_quote_id=quote_id and reason=btrim(justification);
 if found then return ticket;end if;
 select * into quote from public.repricing_quotes where id=quote_id;
 if not found or quote.requested_by<>auth.uid() or quote.expires_at<now() then raise exception 'The quote is expired or unavailable';end if;
 select * into policy from public.repricing_policies where id=quote.policy_id;
 if not found or quote.policy_version<>policy.version or policy.mode<>'manual' or quote.currency<>policy.currency or quote.amount<policy.floor then raise exception 'Policy changed or is outside manual mode';end if;
 select * into listing from public.offers where id=policy.offer_id;
 if not found then raise exception 'Synchronize the listing';end if;
 ticket:=public.request_marketplace_operation(jsonb_build_object('kind','offer.price','body',jsonb_build_object('amount',quote.amount,'currency',quote.currency)),policy.offer_id,listing.updated_at,quote.before_snapshot,justification,request_key);
 update public.approval_requests set repricing_quote_id=quote.id where id=ticket;
 return ticket;
end $$;

create function public.request_automatic_delivery(operation_id uuid,transfer_confirmed boolean) returns void language plpgsql security definer set search_path=public as $$
declare ticket public.approval_requests;
begin
 select * into ticket from public.approval_requests where id=operation_id for update;
 if not public.has_permission('orders.deliver') or auth.jwt()->>'aal' is distinct from 'aal2' or transfer_confirmed is distinct from true
  or ticket.id is null or ticket.requester_id<>auth.uid() or ticket.status<>'pending' or ticket.payload->'change'->>'kind'<>'order.deliver'
  or not exists(select 1 from public.workspace_preferences where id and auto_delivery_enabled) then
  raise exception 'Explicit verified-fulfillment opt-in and workspace authorization are required' using errcode='42501';end if;
 update public.approval_requests set automatic_delivery_requested=true,fulfillment_confirmed_at=now() where id=operation_id;
 perform public.audit_event('delivery.automation_requested','approval',operation_id::text,jsonb_build_object('transfer_confirmed',true));
end $$;

revoke all on function public.save_staff_preferences(boolean,integer),public.save_repricing_policy(text,numeric,numeric,integer,text,integer,boolean),public.review_repricing_policy(uuid,uuid,boolean,text),public.request_quoted_repricing(uuid,text,uuid),public.request_automatic_delivery(uuid,boolean),public.enforce_marketplace_floor() from public,anon,authenticated;
grant execute on function public.save_staff_preferences(boolean,integer),public.save_repricing_policy(text,numeric,numeric,integer,text,integer,boolean),public.review_repricing_policy(uuid,uuid,boolean,text),public.request_quoted_repricing(uuid,text,uuid),public.request_automatic_delivery(uuid,boolean) to authenticated;
