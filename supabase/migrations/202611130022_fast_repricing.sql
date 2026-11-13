-- Faster checks remain opt-in. Every actual write retains scoped authority,
-- market/floor checks and durable one-time claims.
alter table public.repricing_policies drop constraint repricing_policies_interval_seconds_check;
alter table public.repricing_policies add constraint repricing_policies_interval_seconds_check check(interval_seconds between 15 and 86400);
create function public.validate_repricing_tick() returns trigger language plpgsql set search_path=public as $$
begin
 if new.difference>0 and new.difference*power(10::numeric,new.decimals)<1 then raise exception 'The configured precision cannot represent the undercut difference' using errcode='22023';end if;
 return new;
end $$;
create trigger repricing_tick_precision before insert or update of difference,decimals on public.repricing_policies for each row execute function public.validate_repricing_tick();
revoke all on function public.validate_repricing_tick() from public,anon,authenticated;
