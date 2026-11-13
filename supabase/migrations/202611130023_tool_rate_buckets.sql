-- Separate application budgets; the provider cooldown remains shared.
create or replace function public.consume_rate_limit(bucket text,max_hits integer,window_seconds integer)
 returns boolean language plpgsql security definer set search_path=public as $$
declare result integer;
begin
 if not public.staff_active() then raise exception 'Access denied' using errcode='42501';end if;
 if bucket not in ('orders.sync','team.invite','operations.write','integration.connect','integration.health',
  'marketplace.request','marketplace.execute','marketplace.comparison','reports.download','seller.read','notifications.read','offers.batch_preview') then raise exception 'Invalid bucket';end if;
 max_hits:=case bucket when 'orders.sync' then 20 when 'operations.write' then 30
  when 'integration.connect' then 3 when 'integration.health' then 3 when 'reports.download' then 3 when 'seller.read' then 3 when 'offers.batch_preview' then 3 else 10 end;
 window_seconds:=60;
 insert into public.rate_limits(key) values(auth.uid()::text||':'||bucket) on conflict(key) do update set
  hits=case when rate_limits.window_start<now()-make_interval(secs=>window_seconds) then 1 else rate_limits.hits+1 end,
  window_start=case when rate_limits.window_start<now()-make_interval(secs=>window_seconds) then now() else rate_limits.window_start end returning hits into result;
 return result<=max_hits;
end $$;
revoke all on function public.consume_rate_limit(text,integer,integer) from public,anon,authenticated;
grant execute on function public.consume_rate_limit(text,integer,integer) to authenticated;
