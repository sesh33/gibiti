import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
let db: PGlite;
const owner = "11111111-1111-4111-8111-111111111111",
  viewer = "22222222-2222-4222-8222-222222222222",
  ownerSession = "33333333-3333-4333-8333-333333333333",
  viewerSession = "44444444-4444-4444-8444-444444444444",
  machineSession = "55555555-5555-4555-8555-555555555555";
async function identity(id: string, session: string) {
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({
      sub: id,
      session_id: session,
      role: "authenticated",
      aal: "aal2",
    }),
  ]);
  await db.exec("set role authenticated");
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
 grant usage on schema auth to authenticated;grant execute on all functions in schema auth to authenticated;
 alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
  for (const file of readdirSync("supabase/migrations")
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await db.exec(
      readFileSync("supabase/migrations/" + file, "utf8").replace(
        "create extension if not exists pgcrypto;",
        "",
      ),
    );
  await db.query("insert into auth.users values($1),($2)", [owner, viewer]);
  await db.query(
    "insert into public.users(id,email,display_name,role) values($1,'owner@example.test','Owner','OWNER'),($2,'viewer@example.test','Viewer','VIEWER')",
    [owner, viewer],
  );
  await db.query(
    "insert into public.employee_sessions(id,user_id,session_kind) values($1,$2,'employee'),($3,$4,'employee'),($5,$2,'automation')",
    [ownerSession, owner, viewerSession, viewer, machineSession],
  );
}, 30000);
beforeEach(async () => {
  await db.exec("reset role");
});
afterAll(async () => {
  await db?.close();
});

it("keeps private runtime diagnostics service-only without activating any background switches", async () => {
  const grants = await db.query<{
    anon: boolean;
    staff: boolean;
    service: boolean;
  }>(
    "select has_function_privilege('anon','public.integration_runtime_health()','execute') as anon,has_function_privilege('authenticated','public.integration_runtime_health()','execute') as staff,has_function_privilege('service_role','public.integration_runtime_health()','execute') as service",
  );
  expect(grants.rows[0]).toEqual({ anon: false, staff: false, service: true });
  expect(
    (
      await db.query<{ active: boolean }>(
        "select poll_enabled or auto_delivery_enabled or auto_pricing_enabled as active from public.workspace_preferences where id",
      )
    ).rows[0].active,
  ).toBe(false);
  await db.query(
    "update public.automation_runtime set actor_id=$1,session_id=$2 where id",
    [owner, machineSession],
  );
  await db.exec("set role service_role");
  const result = (
    await db.query<{ health: Record<string, unknown> }>(
      "select public.integration_runtime_health() as health",
    )
  ).rows[0].health;
  expect(result).toMatchObject({
    authority_valid: true,
    due_work: false,
    scheduler_configured: false,
    scheduler_job_active: null,
    last_dispatch_at: null,
    pending_backfill_pages: 0,
  });
  expect(result).not.toHaveProperty("actor_id");
  expect(result).not.toHaveProperty("session_id");
  expect(result).not.toHaveProperty("worker_origin");
  await db.exec("reset role");
  await db.query(
    "update public.employee_sessions set revoked_at=now() where id=$1",
    [machineSession],
  );
  await db.exec("set role service_role");
  expect(
    (
      await db.query<{ health: { authority_valid: boolean } }>(
        "select public.integration_runtime_health() as health",
      )
    ).rows[0].health.authority_valid,
  ).toBe(false);
});

it("returns the latest error for each known source while retaining settings RLS", async () => {
  await db.exec(
    "insert into public.integration_errors(provider,code,created_at) values('eldorado','ELDORADO_UNREACHABLE','2026-11-15T10:00:00Z'),('eldorado','ELDORADO_ACCESS_DENIED','2026-11-15T11:00:00Z'),('eldorado-offers:predefined','UPSTREAM_CONTRACT','2026-11-15T10:00:00Z'),('unknown-source','PRIVATE','2026-11-15T10:00:00Z')",
  );
  await identity(owner, ownerSession);
  const result = await db.query<{ provider: string; code: string }>(
    "select provider,code from public.integration_latest_errors() order by provider",
  );
  expect(result.rows).toEqual([
    { provider: "eldorado", code: "ELDORADO_ACCESS_DENIED" },
    { provider: "eldorado-offers:predefined", code: "UPSTREAM_CONTRACT" },
  ]);
  await db.exec("reset role");
  await identity(viewer, viewerSession);
  expect(
    (await db.query("select * from public.integration_latest_errors()")).rows,
  ).toEqual([]);
});

it("captures failed scheduler HTTP status without recording or exposing response contents", async () => {
  // In-memory HTTP fixture only: no network or real commercial request exists.
  await db.exec(`create schema extensions;create schema vault;
 create type extensions.http_header as (field text,value text);
 create function extensions.http_header(text,text) returns extensions.http_header language sql as $$select row($1,$2)::extensions.http_header$$;
 create type extensions.http_request as (method text,uri text,headers extensions.http_header[],content_type text,content text);
 create table public.scheduler_http_fixture(status integer,content text,fail boolean);
 insert into public.scheduler_http_fixture values(401,'private fixture body',false);
 create function extensions.http_set_curlopt(text,text) returns boolean language sql as $$select true$$;
 create function extensions.http(extensions.http_request) returns table(status integer,content text) language plpgsql as $$begin
  if exists(select 1 from public.scheduler_http_fixture where fail) then raise exception 'private transport fixture';end if;
  return query select f.status,f.content from public.scheduler_http_fixture f;
 end$$;
 create table vault.decrypted_secrets(name text,decrypted_secret text);
 insert into vault.decrypted_secrets values('rivox_worker_bearer','synthetic fixture credential');
 alter table public.workspace_preferences disable trigger workspace_connection_guard;
 update public.workspace_preferences set poll_enabled=true where id;
 update public.automation_runtime set scheduler_configured=true,worker_origin='https://rivox.example',last_poll_at=null,backoff_until=null,leased_until=null where id;`);
  const sql = readFileSync("supabase/automation-scheduler.sql", "utf8"),
    migration = readFileSync(
      "supabase/migrations/202611150025_integration_health.sql",
      "utf8",
    ),
    body = sql.match(
      /create or replace function public\.dispatch_rivox_worker\(\)[\s\S]*?end \$\$;/,
    )?.[0];
  expect(body).toBeTruthy();
  // Existing installations receive exactly the same dispatcher body by migration.
  expect(migration).toContain(body);
  await db.exec(body!);
  await db.exec(
    "revoke all on function public.dispatch_rivox_worker() from public,anon,authenticated;select public.dispatch_rivox_worker()",
  );
  let runtime = (
    await db.query<{
      last_error_code: string | null;
      last_dispatch_status: number | null;
      last_dispatch_at: string | null;
    }>(
      "select last_error_code,last_dispatch_status,last_dispatch_at from public.automation_runtime where id",
    )
  ).rows[0];
  expect(runtime).toMatchObject({
    last_error_code: "SCHEDULER_HTTP_401",
    last_dispatch_status: 401,
  });
  expect(runtime.last_dispatch_at).not.toBeNull();
  expect(JSON.stringify(runtime)).not.toContain("private");
  await db.exec(
    "update public.scheduler_http_fixture set status=200;select public.dispatch_rivox_worker()",
  );
  runtime = (
    await db.query<typeof runtime>(
      "select last_error_code,last_dispatch_status,last_dispatch_at from public.automation_runtime where id",
    )
  ).rows[0];
  expect(runtime.last_error_code).toBeNull();
  expect(runtime.last_dispatch_status).toBe(200);
  await db.exec(
    "update public.scheduler_http_fixture set fail=true;select public.dispatch_rivox_worker()",
  );
  runtime = (
    await db.query<typeof runtime>(
      "select last_error_code,last_dispatch_status,last_dispatch_at from public.automation_runtime where id",
    )
  ).rows[0];
  expect(runtime).toMatchObject({
    last_error_code: "SCHEDULER_HTTP_FAILED",
    last_dispatch_status: null,
  });
  expect(JSON.stringify(runtime)).not.toContain("private");
});
