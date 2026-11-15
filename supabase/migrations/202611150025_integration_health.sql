-- Operational metadata only. Does not enable scheduling or commercial actions.
alter table public.automation_runtime
 add column last_dispatch_at timestamptz,
 add column last_dispatch_status integer check(last_dispatch_status between 100 and 599);

create index integration_errors_provider_created_idx on public.integration_errors(provider,created_at desc);
-- Invoker security retains the existing settings.manage row policy.
create function public.integration_latest_errors() returns table(provider text,code text,created_at timestamptz)
language sql stable security invoker set search_path=public as $$
 select distinct on(e.provider) e.provider,e.code,e.created_at from public.integration_errors e
 where e.provider in ('eldorado','eldorado-offers:predefined','eldorado-offers:flexible','eldorado-offers:items','eldorado-offers:currency')
 order by e.provider,e.created_at desc
$$;
revoke all on function public.integration_latest_errors() from public,anon,authenticated;
grant execute on function public.integration_latest_errors() to authenticated,service_role;

-- Service-only projection: no actor IDs, session IDs, Vault values or HTTP bodies.
create function public.integration_runtime_health() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare runtime public.automation_runtime;settings public.workspace_preferences;job_active boolean;authority boolean;due boolean;
begin
 select * into runtime from public.automation_runtime where id;
 select * into settings from public.workspace_preferences where id;
 if runtime.id is null or settings.id is null then return null;end if;
 if to_regclass('cron.job') is not null then
  execute 'select exists(select 1 from cron.job where jobname=''rivox-hosted-worker'' and active)' into job_active;
 end if;
 authority:=exists(select 1 from public.users u join public.employee_sessions s on s.user_id=u.id
  where u.id=runtime.actor_id and u.active and u.role='OWNER' and s.id=runtime.session_id and s.session_kind='automation' and s.revoked_at is null);
 due:=(settings.poll_enabled and public.market_user_authorized(runtime.actor_id,'orders.read') and (runtime.last_poll_at is null or runtime.last_poll_at<now()-make_interval(secs=>settings.poll_seconds)))
  or (settings.auto_pricing_enabled and exists(select 1 from public.repricing_policies p where p.next_run_at<=now() and public.automatic_policy_authorized(p.id,p.version)))
  or exists(select 1 from public.approval_requests a where a.status in ('approved','executing','blocked')
   and (a.status='approved' or nullif(a.result->>'automationNextCheckAt','')::timestamptz is null or (a.result->>'automationNextCheckAt')::timestamptz<=now())
   and ((settings.auto_delivery_enabled and a.automatic_delivery_requested and a.fulfillment_confirmed_at is not null and a.payload->'change'->>'kind'='order.deliver')
    or (settings.auto_pricing_enabled and a.payload->>'automaticPolicyId' is not null and public.automatic_policy_authorized((a.payload->>'automaticPolicyId')::uuid,(a.payload->>'automaticPolicyVersion')::uuid))));
 return jsonb_build_object(
  'scheduler_configured',runtime.scheduler_configured,'scheduler_job_active',job_active,'authority_valid',authority,'due_work',due,
  'leased_until',runtime.leased_until,'last_heartbeat_at',runtime.last_heartbeat_at,'last_poll_at',runtime.last_poll_at,
  'last_error_code',runtime.last_error_code,'backoff_until',runtime.backoff_until,
  'last_dispatch_at',runtime.last_dispatch_at,'last_dispatch_status',runtime.last_dispatch_status,
  'provider_backoff_until',(select not_before from public.integration_rate_state where provider='eldorado'),
  'pending_backfill_pages',(select count(*) from public.automation_sync_cursors));
end $$;
revoke all on function public.integration_runtime_health() from public,anon,authenticated;
grant execute on function public.integration_runtime_health() to service_role;

-- Existing installations may have the optional provider scheduler. Replace its
-- diagnostics without installing extensions, creating a job or enabling flags.
do $health$begin
 if to_regprocedure('public.dispatch_rivox_worker()') is not null
  and exists(select 1 from pg_extension where extname='http')
  and to_regclass('vault.decrypted_secrets') is not null then
 execute $dispatcher$
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
$dispatcher$;
 execute 'revoke all on function public.dispatch_rivox_worker() from public,anon,authenticated';
 end if;
end $health$;
