-- Source of verification is server configuration, never a browser-supplied URL.
alter table public.integration_credentials add column verified_origin text;
create function public.save_seller_credentials(credential_client_id text,credential_envelope text,actor uuid,actor_session uuid,verification_origin text)
 returns void language plpgsql security definer set search_path=public as $$
begin
 perform public.save_seller_credentials(credential_client_id,credential_envelope,actor,actor_session);
 update public.integration_credentials set verified_origin=verification_origin where provider='eldorado';
end $$;
create function public.verify_seller_connection(actor uuid,actor_session uuid,verification_origin text)
 returns void language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from public.users where id=actor and active and role='OWNER')
  or not exists(select 1 from public.employee_sessions where id=actor_session and user_id=actor and revoked_at is null)
  or exists(select 1 from public.revoked_auth_sessions where session_id=actor_session) then raise exception 'Active Owner session required' using errcode='42501';end if;
 update public.integration_credentials set verified_at=now(),verified_origin=verification_origin where provider='eldorado' and updated_by=actor;
 if not found then raise exception 'No saved connection';end if;
 insert into public.audit_logs(actor_id,action,target_type,target_id,metadata) values(actor,'integration.read_verified','integration','eldorado',jsonb_build_object('origin',verification_origin));
end $$;
revoke all on function public.save_seller_credentials(text,text,uuid,uuid,text),public.verify_seller_connection(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.save_seller_credentials(text,text,uuid,uuid,text),public.verify_seller_connection(uuid,uuid,text) to service_role;

create table public.integration_rate_state(provider text primary key check(provider='eldorado'),not_before timestamptz not null,updated_at timestamptz not null default now());
alter table public.integration_rate_state enable row level security;
revoke all on public.integration_rate_state from public,anon,authenticated;
grant select,insert,update on public.integration_rate_state to service_role;
create function public.defer_eldorado_requests(until_time timestamptz) returns void language sql security definer set search_path=public as $$
 insert into public.integration_rate_state(provider,not_before) values('eldorado',until_time)
 on conflict(provider) do update set not_before=greatest(integration_rate_state.not_before,excluded.not_before),updated_at=now()
$$;
revoke all on function public.defer_eldorado_requests(timestamptz) from public,anon,authenticated;
grant execute on function public.defer_eldorado_requests(timestamptz) to service_role;

-- No background traffic can be enabled through direct authenticated RPC calls
-- before a real read has been verified from the configured hosted origin.
create function public.guard_workspace_connection() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.poll_enabled or new.auto_delivery_enabled or new.auto_pricing_enabled then
  if not exists(select 1 from public.automation_runtime where id and scheduler_configured) then raise exception 'The hosted scheduler is not configured' using errcode='55000';end if;
  if not exists(select 1 from public.integration_credentials c join public.automation_runtime r on r.id
    where c.provider='eldorado' and c.verified_origin is not null and c.verified_origin=r.worker_origin) then
   raise exception 'Verify the connection from the hosted application before enabling background traffic' using errcode='55000';end if;
 end if;
 return new;
end $$;
create trigger workspace_connection_guard before insert or update on public.workspace_preferences for each row execute function public.guard_workspace_connection();
revoke all on function public.guard_workspace_connection() from public,anon,authenticated;
