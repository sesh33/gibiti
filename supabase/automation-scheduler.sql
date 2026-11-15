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
declare secret text;origin text;response_status integer;
begin
 if not exists(select 1 from public.workspace_preferences where id and (poll_enabled or auto_delivery_enabled or auto_pricing_enabled)) then return;end if;
 if exists(select 1 from public.automation_runtime where id and (backoff_until>now() or leased_until>now())) then return;end if;
 if not (
  exists(select 1 from public.workspace_preferences w join public.automation_runtime r on r.id where w.id and w.poll_enabled and (r.last_poll_at is null or r.last_poll_at<now()-make_interval(secs=>w.poll_seconds)))
  or exists(select 1 from public.repricing_policies p where p.next_run_at<=now() and public.automatic_policy_authorized(p.id,p.version))
  or exists(select 1 from public.approval_requests a join public.workspace_preferences w on w.id where a.status in ('approved','executing','blocked') and
    (a.status='approved' or nullif(a.result->>'automationNextCheckAt','')::timestamptz is null or (a.result->>'automationNextCheckAt')::timestamptz<=now()) and
    ((w.auto_delivery_enabled and a.automatic_delivery_requested and a.fulfillment_confirmed_at is not null) or
     (w.auto_pricing_enabled and a.payload->>'automaticPolicyId' is not null)))
 ) then return;end if;
 select worker_origin into origin from public.automation_runtime where id and scheduler_configured;
 if origin is null or origin !~ '^https://[A-Za-z0-9.-]+$' then
  update public.automation_runtime set last_error_code='SCHEDULER_CONFIGURATION_INVALID' where id;return;
 end if;
 select decrypted_secret into secret from vault.decrypted_secrets where name='rivox_worker_bearer';
 if secret is null then update public.automation_runtime set last_error_code='SCHEDULER_CREDENTIAL_MISSING' where id;return;end if;
 perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','50000');
 select status into response_status from extensions.http(('POST',origin||'/api/automation/worker',array[extensions.http_header('Authorization','Bearer '||secret)],'application/json','{"mode":"run"}')::extensions.http_request);
 update public.automation_runtime set last_dispatch_at=clock_timestamp(),last_dispatch_status=response_status,
  last_error_code=case when response_status between 200 and 299 then
   case when last_error_code like 'SCHEDULER_%' then null else last_error_code end
   else 'SCHEDULER_HTTP_'||coalesce(response_status::text,'FAILED') end where id;
 exception when others then
  -- Transport errors can contain Authorization or diagnostics. Store no text.
  update public.automation_runtime set last_dispatch_at=clock_timestamp(),last_dispatch_status=null,last_error_code='SCHEDULER_HTTP_FAILED' where id;
end $$;
revoke all on function public.dispatch_rivox_worker() from public,anon,authenticated;
-- pg_cron 1.6+ supports seconds schedules. Reusing the name updates the job;
-- it does not create parallel duplicate workers on redeployment.
select cron.schedule('rivox-hosted-worker','15 seconds','select public.dispatch_rivox_worker();');
