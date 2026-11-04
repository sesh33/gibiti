import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

let db: PGlite;
let inheritedAnonymousBootstrap = false;
let inheritedStaffAudit = false;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb
    $$;
    create function auth.uid() returns uuid language sql stable as $$
      select (auth.jwt()->>'sub')::uuid
    $$;
    grant usage on schema auth to authenticated;
    grant execute on all functions in schema auth to authenticated;
    alter default privileges in schema public
      grant execute on functions to anon,authenticated,service_role;
  `);
  const files = readdirSync("supabase/migrations")
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const fix = "202610270013_explicit_function_grants.sql";
  for (const filename of files.filter((name) => name < fix))
    await db.exec(
      readFileSync("supabase/migrations/" + filename, "utf8").replace(
        "create extension if not exists pgcrypto;",
        "",
      ),
    );
  const baseline = await db.query<{ anon_bootstrap: boolean; staff_audit: boolean }>(
    `select
      has_function_privilege('anon','public.bootstrap_owner(uuid,text,text)','EXECUTE') as anon_bootstrap,
      has_function_privilege('authenticated','public.audit_event(text,text,text,jsonb)','EXECUTE') as staff_audit`,
  );
  inheritedAnonymousBootstrap = baseline.rows[0].anon_bootstrap;
  inheritedStaffAudit = baseline.rows[0].staff_audit;
  await db.exec(readFileSync("supabase/migrations/" + fix, "utf8"));
  await db.exec(
    "create function public.synthetic_future_rpc() returns integer language sql as $$select 1$$;",
  );
}, 30_000);

afterAll(async () => {
  await db?.close();
});

it("models managed Supabase direct grants that a PUBLIC-only revoke cannot remove", () => {
  expect(inheritedAnonymousBootstrap).toBe(true);
  expect(inheritedStaffAudit).toBe(true);
});

it("denies every public application RPC to anonymous callers", async () => {
  const result = await db.query<{ count: number }>(`
    select count(*)::integer as count from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and has_function_privilege('anon',p.oid,'EXECUTE')
  `);
  expect(result.rows[0].count).toBe(0);
});

it("keeps bootstrap, internal audit, ingestion and trigger helpers out of staff RPC access", async () => {
  for (const signature of [
    "public.bootstrap_owner(uuid,text,text)",
    "public.audit_event(text,text,text,jsonb)",
    "public.persist_order_page(jsonb,jsonb,text,uuid,uuid)",
    "public.persist_offer_page(jsonb,text,jsonb,uuid,uuid)",
    "public.manage_staff(uuid,public.staff_role,boolean,jsonb)",
    "public.record_employee_login()",
    "public.record_inventory_movement()",
    "public.apply_approved_role_label()",
    "public.audit_staff_access_state()",
  ]) {
    const result = await db.query<{ allowed: boolean }>(
      "select has_function_privilege('authenticated',$1,'EXECUTE') as allowed",
      [signature],
    );
    expect(result.rows[0].allowed, signature).toBe(false);
  }
});

it("preserves the guarded staff RPCs and authorized server ingestion", async () => {
  for (const [role, signature] of [
    ["authenticated", "public.my_permissions()"],
    ["authenticated", "public.register_employee_session()"],
    ["authenticated", "public.assign_order(uuid,uuid)"],
    ["authenticated", "public.revoke_own_employee_session()"],
    ["service_role", "public.bootstrap_owner(uuid,text,text)"],
    ["service_role", "public.persist_order_page(jsonb,jsonb,text,uuid,uuid)"],
    ["service_role", "public.persist_offer_page(jsonb,text,jsonb,uuid,uuid)"],
  ]) {
    const result = await db.query<{ allowed: boolean }>(
      "select has_function_privilege($1,$2,'EXECUTE') as allowed",
      [role, signature],
    );
    expect(result.rows[0].allowed, role + ": " + signature).toBe(true);
  }
});

it("denies direct anonymous/staff invocation and defaults new RPCs to private", async () => {
  for (const role of ["anon", "authenticated"]) {
    const result = await db.query<{ allowed: boolean }>(
      "select has_function_privilege($1,'public.synthetic_future_rpc()','EXECUTE') as allowed",
      [role],
    );
    expect(result.rows[0].allowed).toBe(false);
    await db.exec("set role " + role);
    try {
      await expect(
        db.exec(
          "select public.bootstrap_owner('11111111-1111-4111-8111-111111111111','synthetic@example.test','Synthetic');",
        ),
      ).rejects.toThrow(/permission denied for function bootstrap_owner/i);
      await expect(
        db.exec("select public.audit_event('forged','order','synthetic','{}');"),
      ).rejects.toThrow(/permission denied for function audit_event/i);
    } finally {
      await db.exec("reset role");
    }
  }
  const audit = await db.query<{ count: number }>(
    "select count(*)::integer as count from public.audit_logs",
  );
  expect(audit.rows[0].count).toBe(0);
});
