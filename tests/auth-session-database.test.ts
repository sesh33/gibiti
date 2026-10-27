import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
let db: PGlite;
const owner = "11111111-1111-4111-8111-111111111111",
  future = "22222222-2222-4222-8222-222222222222",
  session = "33333333-3333-4333-8333-333333333333",
  futureSession = "44444444-4444-4444-8444-444444444444";
async function identity(user: string, sid: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: user, session_id: sid, aal: "aal1" }),
  ]);
  await db.exec("set role authenticated");
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;grant usage on schema auth to authenticated;grant execute on all functions in schema auth to authenticated;`,
  );
  for (const filename of readdirSync("supabase/migrations")
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await db.exec(
      readFileSync("supabase/migrations/" + filename, "utf8").replace(
        "create extension if not exists pgcrypto;",
        "",
      ),
    );
  await db.query("insert into auth.users values($1),($2)", [owner, future]);
  await db.query(
    "insert into public.users(id,email,display_name,role) values($1,'owner@example.test','Synthetic Owner','OWNER')",
    [owner],
  );
});
afterAll(async () => {
  await db?.close();
});
it("allows a privileged aal1 account to revoke only its own session before MFA", async () => {
  await identity(owner, session);
  expect(
    (
      await db.query<{ register_employee_session: boolean }>(
        "select public.register_employee_session()",
      )
    ).rows[0].register_employee_session,
  ).toBe(true);
  await db.exec("select public.revoke_own_employee_session()");
  expect(
    (
      await db.query<{ register_employee_session: boolean }>(
        "select public.register_employee_session()",
      )
    ).rows[0].register_employee_session,
  ).toBe(false);
  await db.exec("select public.revoke_own_employee_session()");
});
it("persists revocation before membership exists, so the old JWT cannot register after an invitation", async () => {
  await identity(future, futureSession);
  await db.exec("select public.revoke_own_employee_session()");
  await db.exec("reset role");
  await db.query(
    "insert into public.users(id,email,display_name,role) values($1,'future@example.test','Future staff','VIEWER')",
    [future],
  );
  await identity(future, futureSession);
  expect(
    (
      await db.query<{ register_employee_session: boolean }>(
        "select public.register_employee_session()",
      )
    ).rows[0].register_employee_session,
  ).toBe(false);
});
it("does not expose revocation tombstones through direct database reads", async () => {
  await identity(owner, session);
  await expect(
    db.exec("select * from public.revoked_auth_sessions"),
  ).rejects.toThrow();
});
