create function public.record_employee_login() returns trigger language plpgsql security definer set search_path=public as $$begin
 insert into public.audit_logs(actor_id,action,target_type,target_id) values(new.user_id,'employee.session_started','employee_session',new.id::text);
 return new;
end $$;
revoke all on function public.record_employee_login() from public;
create trigger employee_login_audit after insert on public.employee_sessions for each row execute function public.record_employee_login();
