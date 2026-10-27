-- Persist self-revocation even before staff registration or MFA completion.
-- An old signed JWT must not register a new staff session after logout.
create table public.revoked_auth_sessions (
 session_id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 revoked_at timestamptz not null default now()
);
alter table public.revoked_auth_sessions enable row level security;
revoke all on public.revoked_auth_sessions from anon,authenticated;
grant all on public.revoked_auth_sessions to service_role;
create function public.revoke_own_employee_session() returns void language plpgsql security definer set search_path=public as $$
declare sid uuid;begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501';end if;
 sid:=nullif(auth.jwt()->>'session_id','')::uuid;
 if sid is null then raise exception 'Session identity required' using errcode='42501';end if;
 insert into public.revoked_auth_sessions(session_id,user_id) values(sid,auth.uid())
 on conflict(session_id) do update set revoked_at=least(revoked_auth_sessions.revoked_at,excluded.revoked_at) where revoked_auth_sessions.user_id=auth.uid();
 if not found then raise exception 'Session identity mismatch' using errcode='42501';end if;
 if exists(select 1 from public.users where id=auth.uid()) then
  update public.employee_sessions set revoked_at=coalesce(revoked_at,now()) where id=sid and user_id=auth.uid();
  perform public.audit_event('employee.signed_out','employee_session',sid::text);
 end if;
end $$;
revoke all on function public.revoke_own_employee_session() from public;
grant execute on function public.revoke_own_employee_session() to authenticated;
create or replace function public.register_employee_session() returns boolean language plpgsql security definer set search_path=public as $$
declare sid uuid;begin
 if auth.uid() is null or not exists(select 1 from public.users where id=auth.uid() and active) then return false;end if;
 sid:=nullif(auth.jwt()->>'session_id','')::uuid;
 if sid is null or exists(select 1 from public.revoked_auth_sessions where session_id=sid) then return false;end if;
 insert into public.employee_sessions(id,user_id) values(sid,auth.uid()) on conflict(id) do update set last_seen_at=now() where employee_sessions.user_id=auth.uid() and employee_sessions.revoked_at is null;
 return exists(select 1 from public.employee_sessions where id=sid and user_id=auth.uid() and revoked_at is null);
end $$;
