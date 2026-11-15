-- Local CSV/JSON previews use the documented single-offer creation contract.
-- Preserve create:predefined serialization: submit one reviewed row at a time.
create table public.offer_import_previews (
 id uuid primary key default gen_random_uuid(),created_by uuid not null references public.users(id),
 items jsonb not null check(jsonb_typeof(items)='array' and jsonb_array_length(items) between 1 and 10 and pg_column_size(items)<65536),
 created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '5 minutes',
 submissions jsonb not null default '{}'::jsonb check(jsonb_typeof(submissions)='object')
);
alter table public.offer_import_previews enable row level security;
revoke all on public.offer_import_previews from public,anon,authenticated;
grant select on public.offer_import_previews to authenticated;
grant select,insert on public.offer_import_previews to service_role;
create policy offer_import_previews_read on public.offer_import_previews for select to authenticated
 using(public.has_permission('offers.read') and (created_by=auth.uid() or public.has_permission('audit.read')));

create function public.request_offer_import_row(preview_id uuid,row_index integer,justification text,idempotency uuid)
 returns jsonb language plpgsql security definer set search_path=public as $$
declare preview public.offer_import_previews;entry jsonb;prior jsonb;ticket uuid;row_key text:=row_index::text;
begin
 if not public.has_permission('offers.read') or not public.has_permission('offers.create') or auth.jwt()->>'aal' is distinct from 'aal2' then raise exception 'MFA and listing creation permissions required' using errcode='42501';end if;
 if justification is null or length(btrim(justification)) not between 10 and 2000 or idempotency is null then raise exception 'A reason and request key are required';end if;
 select * into preview from public.offer_import_previews where id=preview_id and created_by=auth.uid() for update;
 if not found then raise exception 'Preview not accessible' using errcode='42501';end if;
 prior:=preview.submissions->row_key;
 if prior is not null then
  if prior->>'key'<>idempotency::text or prior->>'reason'<>btrim(justification) then raise exception 'Row submitted with another key or reason';end if;
  return jsonb_build_object('id',prior->>'id','reused',true);
 end if;
 if preview.expires_at<=now() then raise exception 'Preview expired';end if;
 if row_index is null or row_index<0 or row_index>=jsonb_array_length(preview.items) then raise exception 'Import row not found';end if;
 entry:=preview.items->row_index;
 if entry->'document' is null or jsonb_typeof(entry->'document')<>'object'
  or entry->'document'->'giftCardDetails' is distinct from 'null'::jsonb
  or entry->'document'->'augmentedGame'->'offerAttributes' is distinct from '[]'::jsonb then raise exception 'Invalid safe import document';end if;
 ticket:=public.request_marketplace_operation(jsonb_build_object('kind','offer.create','body',entry->'document'),'new',null,'{}'::jsonb,btrim(justification),idempotency);
 update public.offer_import_previews set submissions=jsonb_set(submissions,array[row_key],jsonb_build_object('id',ticket,'key',idempotency,'reason',btrim(justification))) where id=preview.id;
 perform public.audit_event('offers.import_row_requested','offer_import',preview.id::text,jsonb_build_object('row',row_index,'ticket',ticket));
 return jsonb_build_object('id',ticket,'reused',false);
end $$;
revoke all on function public.request_offer_import_row(uuid,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.request_offer_import_row(uuid,integer,text,uuid) to authenticated;
