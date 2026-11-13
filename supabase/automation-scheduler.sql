-- Provider setup, executed once by the authorized Management API operator.
-- Application migrations remain portable and do not require these extensions.
create extension if not exists pg_cron;
-- Synchronous http keeps Authorization out of pg_net's shared request queue.
create extension if not exists http with schema extensions;
do $$declare f record;begin
 for f in select p.oid::regprocedure as signature from pg_proc p
  join pg_depend d on d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e'
  join pg_extension e on e.oid=d.refobjid where e.extname='http' loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 end loop;
end $$;
revoke all on vault.decrypted_secrets from public,anon,authenticated;

create or replace function public.dispatch_rivox_worker() returns void
language plpgsql security definer set search_path=public as $$
declare secret text;origin text;
begin
 if not exists(select 1 from public.workspace_preferences where id and (poll_enabled or auto_delivery_enabled or auto_pricing_enabled)) then return;end if;
 select worker_origin into origin from public.automation_runtime where id and scheduler_configured;
 if origin is null or origin !~ '^https://[A-Za-z0-9.-]+$' then return;end if;
 select decrypted_secret into secret from vault.decrypted_secrets where name='rivox_worker_bearer';
 if secret is null then return;end if;
 perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','50000');
 perform extensions.http(('POST',origin||'/api/automation/worker',array[extensions.http_header('Authorization','Bearer '||secret)],'application/json','{"mode":"run"}')::extensions.http_request);
 exception when others then
  -- An HTTP exception can include transport diagnostics; never log its text.
  update public.automation_runtime set last_error_code='SCHEDULER_HTTP_FAILED' where id;
end $$;
revoke all on function public.dispatch_rivox_worker() from public,anon,authenticated;
do $$begin
 if not exists(select 1 from cron.job where jobname='rivox-hosted-worker') then
  perform cron.schedule('rivox-hosted-worker','* * * * *','select public.dispatch_rivox_worker();');
 end if;
end $$;
