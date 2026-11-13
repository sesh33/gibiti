-- Ciphertext is available only to the trusted server, never to browser JWTs.
create table public.integration_credentials (
 provider text primary key check(provider='eldorado'),
 client_id text not null check(length(client_id) between 1 and 150),
 encrypted_secret text not null check(length(encrypted_secret) between 20 and 2000),
 verified_at timestamptz not null default now(),
 updated_by uuid not null references public.users(id)
);
alter table public.integration_credentials enable row level security;
revoke all on public.integration_credentials from public,anon,authenticated;
grant select,insert,update on public.integration_credentials to service_role;

create function public.save_seller_credentials(
 credential_client_id text,credential_envelope text,actor uuid,actor_session uuid
) returns void language plpgsql security definer set search_path=public as $$
begin
 -- HTTP verified Owner MFA before testing the remote connection. Recheck
 -- staff/session validity atomically after that network round trip.
 perform 1 from public.users where id=actor and active and role='OWNER' for update;
 if not found then raise exception 'Active Owner required' using errcode='42501';end if;
 perform 1 from public.employee_sessions where id=actor_session and user_id=actor and revoked_at is null for update;
 if not found or exists(select 1 from public.revoked_auth_sessions where session_id=actor_session) then
  raise exception 'Active Owner session required' using errcode='42501';
 end if;
 insert into public.integration_credentials(provider,client_id,encrypted_secret,updated_by)
 values('eldorado',credential_client_id,credential_envelope,actor)
 on conflict(provider) do update set client_id=excluded.client_id,encrypted_secret=excluded.encrypted_secret,
  verified_at=now(),updated_by=excluded.updated_by;
 insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
 values(actor,'integration.connected','integration','eldorado','{"verified_read":true}'::jsonb);
end $$;
revoke all on function public.save_seller_credentials(text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.save_seller_credentials(text,text,uuid,uuid) to service_role;
