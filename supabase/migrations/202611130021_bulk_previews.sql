-- Bulk requests retain the existing independent review and one-time execution
-- for each listing. Only ticket creation is atomic; upstream writes are not.
create table public.offer_batch_previews (
 id uuid primary key default gen_random_uuid(),created_by uuid not null references public.users(id),
 items jsonb not null check(jsonb_typeof(items)='array' and jsonb_array_length(items) between 1 and 10 and pg_column_size(items)<1048576),
 created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '5 minutes',
 request_key uuid unique,reason text,ticket_ids uuid[]
);
alter table public.offer_batch_previews enable row level security;
revoke all on public.offer_batch_previews from public,anon,authenticated;
grant select on public.offer_batch_previews to authenticated;
grant select,insert on public.offer_batch_previews to service_role;
create policy offer_batch_previews_read on public.offer_batch_previews for select to authenticated
 using(public.has_permission('offers.read') and (created_by=auth.uid() or public.has_permission('audit.read')));

create function public.request_offer_batch(preview_id uuid,justification text,idempotency uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare preview public.offer_batch_previews;entry jsonb;ticket uuid;tickets uuid[]:='{}';
begin
 if not public.has_permission('offers.read') or length(btrim(justification)) not between 10 and 2000 or idempotency is null then raise exception 'Listing access and a reason are required' using errcode='42501';end if;
 select * into preview from public.offer_batch_previews where id=preview_id and created_by=auth.uid() for update;
 if not found then raise exception 'Preview not accessible' using errcode='42501';end if;
 if preview.request_key is not null then
  if preview.request_key<>idempotency or preview.reason<>btrim(justification) then raise exception 'Preview already submitted using another key or reason';end if;
  return jsonb_build_object('ids',preview.ticket_ids,'reused',true);
 end if;
 if preview.expires_at<=now() then raise exception 'Preview expired';end if;
 -- Use a stable order for cross-target locks and avoid batch deadlocks.
 for entry in select value from jsonb_array_elements(preview.items) order by value->>'target' loop
  if entry->'change'->>'kind' not in ('offer.price','offer.quantity','offer.details') then raise exception 'Unsupported batch action';end if;
  ticket:=public.request_marketplace_operation(entry->'change',entry->>'target',(entry->>'expectedSnapshot')::timestamptz,entry->'before',btrim(justification),gen_random_uuid());
  tickets:=array_append(tickets,ticket);
 end loop;
 update public.offer_batch_previews set request_key=idempotency,reason=btrim(justification),ticket_ids=tickets where id=preview.id;
 perform public.audit_event('offers.batch_requested','offer_batch',preview.id::text,jsonb_build_object('count',cardinality(tickets),'tickets',tickets));
 return jsonb_build_object('ids',tickets,'reused',false);
end $$;
revoke all on function public.request_offer_batch(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.request_offer_batch(uuid,text,uuid) to authenticated;
