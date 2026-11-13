import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
let db: PGlite;
const owner = "11111111-1111-4111-8111-111111111111",
  admin = "22222222-2222-4222-8222-222222222222",
  sidOwner = "33333333-3333-4333-8333-333333333333",
  sidAdmin = "44444444-4444-4444-8444-444444444444",
  native = "55555555-5555-4555-8555-555555555555",
  order = "66666666-6666-4666-8666-666666666666",
  stamp = "2026-11-13T03:00:00Z";
let keyNumber = 0;
const key = () =>
  "77777777-7777-4777-8777-" + String(++keyNumber).padStart(12, "0");
async function identity(id = owner, aal = "aal2") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({
      sub: id,
      session_id: id === owner ? sidOwner : sidAdmin,
      aal,
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
  await db.query("insert into auth.users values($1),($2)", [owner, admin]);
  await db.query(
    "insert into public.users(id,email,display_name,role) values($1,'owner@example.test','Synthetic Owner','OWNER'),($2,'admin@example.test','Synthetic Admin','ADMIN')",
    [owner, admin],
  );
  await db.query(
    "insert into public.employee_sessions(id,user_id) values($1,$2),($3,$4)",
    [sidOwner, owner, sidAdmin, admin],
  );
  await db.query(
    "insert into public.offers(id,native_id,source,category,title,state,price,currency,quantity,updated_at) values($1,$2,'predefined','Currency','Synthetic listing','Active',1,'USD',10,$3),($4,$2,'currency','Currency','Alias','Active',1,'USD',10,$3)",
    ["predefined:" + native, native, stamp, "currency:" + native],
  );
  await db.query(
    "insert into public.orders(id,buyer_username,quantity,amount,currency,state,product_title,purchased_at,synced_at) values($1,'Synthetic Buyer',1,1,'USD','Paid','Fixture',$2,$2)",
    [order, stamp],
  );
}, 30000);
afterAll(async () => {
  await db?.close();
});
async function request(
  kind = "offer.price",
  body: unknown = { amount: 2, currency: "USD" },
  target = "predefined:" + native,
  requestKey = key(),
) {
  const before = kind.startsWith("order.")
    ? { id: order, state: "Paid", deliveryTime: null }
    : { id: native, state: "Active", price: 1, currency: "USD", quantity: 10 };
  const r = await db.query<{ id: string }>(
    "select public.request_marketplace_operation($1,$2,$3,$4,'Verified requested change',$5) as id",
    [
      JSON.stringify({ kind, ...(body !== undefined ? { body } : {}) }),
      target,
      stamp,
      JSON.stringify(before),
      requestKey,
    ],
  );
  return r.rows[0].id;
}
async function decide(id: string, approve = true) {
  await db.query("select public.decide_approval($1,$2,'Independent review')", [
    id,
    approve,
  ]);
}
async function claim(id: string) {
  return db.query("select public.claim_marketplace_operation($1)", [id]);
}
async function finish(
  id: string,
  status: string,
  proof: unknown,
  code: string | null = null,
) {
  await db.exec("reset role;set role service_role");
  try {
    return await db.query(
      "select public.finish_marketplace_operation($1,$2,$3,$4)",
      [id, status, JSON.stringify(proof), code],
    );
  } finally {
    await db.exec("reset role");
  }
}
let priceTicket: string;
it("records immutable idempotency and rejects self approval", async () => {
  await identity();
  const k = key();
  priceTicket = await request(
    "offer.price",
    { amount: 2, currency: "USD" },
    "predefined:" + native,
    k,
  );
  expect(
    await request(
      "offer.price",
      { amount: 2, currency: "USD" },
      "predefined:" + native,
      k,
    ),
  ).toBe(priceTicket);
  await expect(decide(priceTicket)).rejects.toThrow("Access denied");
  await expect(claim(priceTicket)).rejects.toThrow("not approved");
});
it("locks pause/resume across catalog aliases while a reviewed edit is pending", async () => {
  await identity();
  await expect(
    db.query(
      "select public.begin_offer_availability($1,'pause',$2,$3,'Verified availability change')",
      ["currency:" + native, stamp, key()],
    ),
  ).rejects.toThrow("needs resolution");
});
it("requires reviewer MFA and a one-time claim, then verifies the actual price", async () => {
  await identity(admin, "aal1");
  await expect(decide(priceTicket)).rejects.toThrow();
  await identity(admin);
  await decide(priceTicket);
  await identity();
  await claim(priceTicket);
  await expect(claim(priceTicket)).rejects.toThrow("already claimed");
  await expect(
    finish(priceTicket, "succeeded", {
      verified: true,
      id: native,
      state: "Active",
      price: 3,
      currency: "USD",
      quantity: 10,
    }),
  ).rejects.toThrow("not observed");
  await finish(priceTicket, "blocked", null, "ELDORADO_WRITE_UNKNOWN");
  await expect(finish(priceTicket, "rejected", null, "OTHER")).rejects.toThrow(
    "Unknown operation",
  );
  await finish(priceTicket, "succeeded", {
    verified: true,
    id: native,
    state: "Active",
    price: 2,
    currency: "USD",
    quantity: 10,
  });
  const rows = await db.query<{ price: number }>(
    "select price::float from public.offers where native_id=$1",
    [native],
  );
  expect(rows.rows.map((r) => r.price)).toEqual([2, 2]);
});
it("rechecks revoked permissions after approval", async () => {
  await db.exec("reset role");
  await db.query("update public.offers set updated_at=$1", [stamp]);
  await identity();
  const id = await request("offer.quantity", 5);
  await identity(admin);
  await decide(id);
  await db.exec("reset role");
  await db.query(
    "insert into public.user_permission_overrides values($1,'offers.update_stock',false)",
    [admin],
  );
  await identity();
  await expect(claim(id)).rejects.toThrow("no longer authorized");
  await db.exec("reset role");
  await db.query(
    "delete from public.user_permission_overrides where user_id=$1",
    [admin],
  );
  await identity(admin);
  // An approved request cannot be silently edited or re-approved.
  await expect(decide(id)).rejects.toThrow("already decided");
  await identity();
  await claim(id);
  await finish(id, "rejected", null, "ELDORADO_WRITE_REJECTED");
});
it("keeps delivery tombstones even if a later read temporarily shows Paid again", async () => {
  await identity();
  const id = await request("order.deliver", undefined, order);
  await identity(admin);
  await decide(id);
  await identity();
  await claim(id);
  await finish(id, "succeeded", {
    verified: true,
    id: order,
    state: "Delivered",
    deliveryTime: null,
  });
  await db.exec("reset role");
  await db.query(
    "update public.orders set state='Paid',synced_at=$1 where id=$2",
    [stamp, order],
  );
  await identity();
  await expect(request("order.deliver", undefined, order)).rejects.toThrow(
    "already recorded",
  );
});
it("never grants browser callers completion or lock-helper access", async () => {
  await db.exec("reset role");
  const r = await db.query<{
    staff_finish: boolean;
    anon_claim: boolean;
    staff_trigger: boolean;
  }>(
    "select has_function_privilege('authenticated','public.finish_marketplace_operation(uuid,text,jsonb,text)','execute') as staff_finish,has_function_privilege('anon','public.claim_marketplace_operation(uuid)','execute') as anon_claim,has_function_privilege('authenticated','public.guard_marketplace_lock()','execute') as staff_trigger",
  );
  expect(r.rows[0]).toEqual({
    staff_finish: false,
    anon_claim: false,
    staff_trigger: false,
  });
});

it("full details cannot bypass a denied price or stock permission", async () => {
  await db.exec("reset role");
  await db.query("update public.offers set updated_at=$1", [stamp]);
  await db.query(
    "insert into public.user_permission_overrides values($1,'offers.update_price',false)",
    [owner],
  );
  await identity();
  await expect(
    request("offer.details", {
      details: {},
      augmentedGame: {},
      giftCardDetails: null,
    }),
  ).rejects.toThrow("pricing and stock permissions");
  await db.exec("reset role");
  await db.query(
    "delete from public.user_permission_overrides where user_id=$1",
    [owner],
  );
  await identity();
  const id = await request("offer.details", {
    details: {},
    augmentedGame: {},
    giftCardDetails: null,
  });
  await db.exec("reset role");
  await db.query(
    "insert into public.user_permission_overrides values($1,'offers.update_stock',false)",
    [admin],
  );
  await identity(admin);
  await expect(decide(id)).rejects.toThrow("pricing and stock permissions");
  await db.exec("reset role");
  await db.query(
    "delete from public.user_permission_overrides where user_id=$1",
    [admin],
  );
  await identity(admin);
  await decide(id);
  await identity();
  await claim(id);
  await finish(id, "rejected", null, "ELDORADO_WRITE_REJECTED");
});
it("registers every new throttle and ignores caller-supplied limit overrides", async () => {
  await identity();
  for (const bucket of [
    "integration.health",
    "marketplace.execute",
    "marketplace.comparison",
  ])
    expect(
      (
        await db.query<{ ok: boolean }>(
          "select public.consume_rate_limit($1,99999,0) as ok",
          [bucket],
        )
      ).rows[0].ok,
    ).toBe(true);
  for (let i = 0; i < 4; i++)
    expect(
      (
        await db.query<{ ok: boolean }>(
          "select public.consume_rate_limit('integration.connect',99999,0) as ok",
        )
      ).rows[0].ok,
    ).toBe(i < 3);
});
