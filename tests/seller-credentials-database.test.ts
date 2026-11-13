import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
let db: PGlite;
const owner = "11111111-1111-4111-8111-111111111111",
  admin = "22222222-2222-4222-8222-222222222222",
  session = "33333333-3333-4333-8333-333333333333";
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.users(id uuid primary key,active boolean,role text);
    create table public.employee_sessions(id uuid primary key,user_id uuid,revoked_at timestamptz);
    create table public.revoked_auth_sessions(session_id uuid primary key);
    create table public.audit_logs(actor_id uuid,action text,target_type text,target_id text,metadata jsonb);
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
    insert into public.users values('${owner}',true,'OWNER'),('${admin}',true,'ADMIN');
    insert into public.employee_sessions values('${session}','${owner}',null);`);
  await db.exec(
    readFileSync(
      "supabase/migrations/202611130015_seller_credentials.sql",
      "utf8",
    ),
  );
}, 30000);
afterAll(async () => {
  await db?.close();
});
async function save(actor = owner) {
  await db.exec("set role service_role");
  try {
    await db.query(
      "select public.save_seller_credentials('fixture-client','v1.synthetic-encrypted-secret',$1,$2)",
      [actor, session],
    );
  } finally {
    await db.exec("reset role");
  }
}
it("denies direct reads/writes and the privileged RPC to every browser role", async () => {
  for (const role of ["anon", "authenticated"]) {
    const result = await db.query<{
      readable: boolean;
      writable: boolean;
      executable: boolean;
    }>(
      `select has_table_privilege('${role}','public.integration_credentials','select') as readable,has_table_privilege('${role}','public.integration_credentials','insert') as writable,has_function_privilege('${role}','public.save_seller_credentials(text,text,uuid,uuid)','execute') as executable`,
    );
    expect(result.rows[0]).toEqual({
      readable: false,
      writable: false,
      executable: false,
    });
  }
});
it("allows the trusted server to persist a checked connection with a secret-free audit", async () => {
  await save();
  const row = await db.query<{ client_id: string }>(
    "select client_id from public.integration_credentials",
  );
  expect(row.rows).toEqual([{ client_id: "fixture-client" }]);
  const audit = await db.query<{ action: string; metadata: unknown }>(
    "select action,metadata from public.audit_logs",
  );
  expect(audit.rows).toEqual([
    { action: "integration.connected", metadata: { verified_read: true } },
  ]);
});
it("rejects staff roles, revoked sessions and inactive Owners after the upstream round trip", async () => {
  await expect(save(admin)).rejects.toThrow("Active Owner required");
  await db.query("insert into public.revoked_auth_sessions values($1)", [
    session,
  ]);
  await expect(save()).rejects.toThrow("Active Owner session required");
  await db.exec(
    "delete from public.revoked_auth_sessions; update public.users set active=false",
  );
  await expect(save()).rejects.toThrow("Active Owner required");
  const audit = await db.query("select * from public.audit_logs");
  expect(audit.rows).toHaveLength(1);
});
