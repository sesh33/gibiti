import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
let db: PGlite;
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
const session = "33333333-3333-4333-8333-333333333333",
  otherSession = "44444444-4444-4444-8444-444444444444";
let counter = 0;
const key = () =>
  "55555555-5555-4555-8555-" + String(++counter).padStart(12, "0");
const document = {
  details: {
    description: "Synthetic product",
    guaranteedDeliveryTime: "Minute20",
    pricing: {
      quantity: 10,
      minQuantity: 1,
      volumeDiscounts: [],
      pricePerUnit: { amount: 1.09, currency: "USD" },
    },
    deliveryMethod: "InGameTrade",
  },
  augmentedGame: {
    gameId: "verified-game",
    category: "TopUp",
    tradeEnvironmentId: null,
    offerAttributes: [],
  },
  giftCardDetails: null,
};
async function root() {
  await db.exec("reset role");
}
async function identity(id = owner, aal = "aal2") {
  await root();
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({
      sub: id,
      session_id: id === owner ? session : otherSession,
      aal,
      role: "authenticated",
    }),
  ]);
  await db.exec("set role authenticated");
}
async function preview(
  docs = [
    document,
    {
      ...document,
      augmentedGame: { ...document.augmentedGame, gameId: "another-game" },
    },
  ],
) {
  await root();
  return (
    await db.query<{ id: string }>(
      "insert into public.offer_import_previews(created_by,items) values($1,$2) returning id",
      [
        owner,
        JSON.stringify(
          docs.map((value, index) => ({ row: index + 1, document: value })),
        ),
      ],
    )
  ).rows[0].id;
}
async function request(id: string, row = 0, requestKey = key()) {
  return (
    await db.query<{ value: { id: string; reused: boolean } }>(
      "select public.request_offer_import_row($1,$2,'Verified every imported product field',$3) as value",
      [id, row, requestKey],
    )
  ).rows[0].value;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);
  create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
  create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
  grant usage on schema auth to authenticated;grant execute on all functions in schema auth to authenticated;
  alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
  for (const name of readdirSync("supabase/migrations")
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await db.exec(
      readFileSync("supabase/migrations/" + name, "utf8").replace(
        "create extension if not exists pgcrypto;",
        "",
      ),
    );
  await db.query("insert into auth.users values($1),($2)", [owner, other]);
  await db.query(
    "insert into public.users(id,email,display_name,role) values($1,'owner@example.test','Synthetic Owner','OWNER'),($2,'admin@example.test','Synthetic Other','ADMIN')",
    [owner, other],
  );
  await db.query(
    "insert into public.employee_sessions(id,user_id) values($1,$2),($3,$4)",
    [session, owner, otherSession, other],
  );
}, 30000);
afterEach(async () => {
  await root();
  await db.exec(
    "update public.approval_requests set status='rejected' where status in ('pending','approved','executing','blocked');delete from public.user_permission_overrides",
  );
});
afterAll(async () => {
  await db?.close();
});

it("creates one reviewed request, preserves the global create lock, and recovers an identical row replay", async () => {
  const id = await preview(),
    requestKey = key();
  await identity();
  const first = await request(id, 0, requestKey);
  expect(first.reused).toBe(false);
  await expect(request(id, 1)).rejects.toThrow(/needs resolution/);
  expect(await request(id, 0, requestKey)).toEqual({
    id: first.id,
    reused: true,
  });
  await expect(request(id, 0, key())).rejects.toThrow(/another key/);
  await root();
  await db.query(
    "update public.approval_requests set status='rejected' where id=$1",
    [first.id],
  );
  await identity();
  expect((await request(id, 1)).reused).toBe(false);
  await root();
  const rows = (
    await db.query<{
      payload: { change: { kind: string }; lockKey: string };
      external_attempted: boolean;
    }>("select payload,external_attempted from public.approval_requests")
  ).rows;
  expect(rows).toHaveLength(2);
  expect(
    rows.every(
      (row) =>
        row.payload.change.kind === "offer.create" &&
        row.payload.lockKey === "create:predefined" &&
        !row.external_attempted,
    ),
  ).toBe(true);
});
it("rejects expired, cross-user, low-assurance and permission-revoked submissions without tickets", async () => {
  const id = await preview();
  await identity(other);
  await expect(request(id)).rejects.toThrow(/not accessible/);
  await identity(owner, "aal1");
  await expect(request(id)).rejects.toThrow(/MFA/);
  await root();
  await db.query(
    "insert into public.user_permission_overrides(user_id,permission,allowed) values($1,'offers.create',false)",
    [owner],
  );
  await identity();
  await expect(request(id)).rejects.toThrow(/permissions required/);
  await root();
  await db.exec("delete from public.user_permission_overrides");
  await db.query(
    "update public.offer_import_previews set expires_at=now()-interval '1 minute' where id=$1",
    [id],
  );
  await identity();
  await expect(request(id)).rejects.toThrow(/expired/);
  await root();
  expect(
    (
      await db.query<{ count: number }>(
        "select count(*)::integer as count from public.approval_requests where status='pending'",
      )
    ).rows[0].count,
  ).toBe(0);
});
it("recovers an accepted row even after expiry and prevents browser insertion or anonymous RPC", async () => {
  const id = await preview(),
    requestKey = key();
  await identity();
  const first = await request(id, 0, requestKey);
  await root();
  await db.query(
    "update public.offer_import_previews set expires_at=now()-interval '1 minute' where id=$1",
    [id],
  );
  await identity();
  expect(await request(id, 0, requestKey)).toEqual({
    id: first.id,
    reused: true,
  });
  await root();
  for (const role of ["anon", "authenticated"])
    expect(
      (
        await db.query<{ allowed: boolean }>(
          "select has_table_privilege($1,'public.offer_import_previews','INSERT') as allowed",
          [role],
        )
      ).rows[0].allowed,
    ).toBe(false);
  expect(
    (
      await db.query<{ allowed: boolean }>(
        "select has_function_privilege('anon','public.request_offer_import_row(uuid,integer,text,uuid)','EXECUTE') as allowed",
      )
    ).rows[0].allowed,
  ).toBe(false);
});
