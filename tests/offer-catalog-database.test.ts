import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
let db: PGlite;
const owner = "11111111-1111-4111-8111-111111111111",
  viewer = "22222222-2222-4222-8222-222222222222",
  sid = "33333333-3333-4333-8333-333333333333",
  viewerSid = "44444444-4444-4444-8444-444444444444";
const offerId = "predefined:55555555-5555-4555-8555-555555555555",
  stamp = "2026-11-15T12:00:00Z";
async function identity(id = owner, aal = "aal2") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({
      sub: id,
      session_id: id === owner ? sid : viewerSid,
      aal,
      role: "authenticated",
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
    "insert into public.users(id,email,display_name,role) values($1,'owner@fixture.test','Owner','OWNER'),($2,'viewer@fixture.test','Viewer','SUPPORT_AGENT')",
    [owner, viewer],
  );
  await db.query(
    "insert into public.employee_sessions(id,user_id) values($1,$2),($3,$4)",
    [sid, owner, viewerSid, viewer],
  );
  await db.query(
    "insert into public.offers(id,native_id,source,category,title,state,price,currency,quantity,game_id,updated_at) values($1,'55555555-5555-4555-8555-555555555555','predefined','TopUp','Moedas São Paulo 東京','Active',1.01,'USD',5,'fixture-game',$2)",
    [offerId, stamp],
  );
}, 30000);
afterAll(async () => {
  await db?.close();
});

it("saves auditable local labels without changing upstream state, stock or read timestamp", async () => {
  await identity();
  await db.query(
    "select public.save_offer_catalog_tags($1,' Europe ','PC','1000')",
    [offerId],
  );
  const row = (
    await db.query<{
      catalog_region: string;
      catalog_search: string;
      quantity: number;
      state: string;
      stamp: string;
    }>(
      "select catalog_region,catalog_search,quantity,state,updated_at::text as stamp from public.offers where id=$1",
      [offerId],
    )
  ).rows[0];
  expect(row.catalog_region).toBe("Europe");
  expect(row.catalog_search).toContain("São Paulo 東京");
  expect(row.catalog_search).toContain("Europe PC 1000");
  expect(Number(row.quantity)).toBe(5);
  expect(row.state).toBe("Active");
  expect(Date.parse(row.stamp)).toBe(Date.parse(stamp));
  await db.exec("reset role");
  expect(
    (
      await db.query(
        "select metadata from public.audit_logs where action='offers.catalog_labels_saved'",
      )
    ).rows,
  ).toEqual([
    expect.objectContaining({
      metadata: expect.objectContaining({
        upstream_write: false,
        scope: "local_only",
      }),
    }),
  ]);
});

it("blocks missing catalog permission, missing MFA, and direct table writes", async () => {
  await identity(viewer);
  await expect(
    db.query("select public.save_offer_catalog_tags($1,'EU','PC','1000')", [
      offerId,
    ]),
  ).rejects.toThrow();
  await identity(owner, "aal1");
  await expect(
    db.query("select public.save_offer_catalog_tags($1,'EU','PC','1000')", [
      offerId,
    ]),
  ).rejects.toThrow();
  await identity();
  await expect(
    db.query("update public.offers set catalog_region='unsafe' where id=$1", [
      offerId,
    ]),
  ).rejects.toThrow();
});

it("syncs public fields while retaining workspace labels and exposes readable facets", async () => {
  await db.exec("reset role;set role service_role");
  const records = [
    {
      id: offerId,
      native_id: "55555555-5555-4555-8555-555555555555",
      source: "predefined",
      category: "TopUp",
      title: "Moedas São Paulo 東京",
      state: "Paused",
      price: 1.01,
      currency: "USD",
      quantity: 8,
      game_id: "fixture-game",
      updated_at: stamp,
      min_quantity: 2,
      unit_system: "Unit1000",
      delivery_time: "Minute20",
      delivery_method: "InGameTrade",
      public_context: {
        attributes: [],
        tradeEnvironmentValues: [],
        offerAttributeIdValues: [],
      },
    },
  ];
  await db.query(
    "select public.persist_offer_page($1::jsonb,'predefined','{}'::jsonb,$2,$3)",
    [JSON.stringify(records), owner, sid],
  );
  await identity();
  const result = (
    await db.query<{ metadata: { categories: string[]; regions: string[] } }>(
      "select public.offer_catalog_facets() as metadata",
    )
  ).rows[0].metadata;
  expect(result.categories).toContain("TopUp");
  expect(result.regions).toContain("Europe");
  const row = (
    await db.query(
      "select min_quantity,unit_system,delivery_time,catalog_region,state from public.offers where id=$1",
      [offerId],
    )
  ).rows[0];
  expect(row).toEqual({
    min_quantity: "2",
    unit_system: "Unit1000",
    delivery_time: "Minute20",
    catalog_region: "Europe",
    state: "Paused",
  });
  await db.exec("reset role;set role anon");
  await expect(
    db.query("select public.offer_catalog_facets()"),
  ).rejects.toThrow();
});
