import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
let db: PGlite;
const owner = "11111111-1111-4111-8111-111111111111",
  admin = "22222222-2222-4222-8222-222222222222",
  viewer = "33333333-3333-4333-8333-333333333333",
  ownerSid = "44444444-4444-4444-8444-444444444444",
  adminSid = "55555555-5555-4555-8555-555555555555",
  viewerSid = "66666666-6666-4666-8666-666666666666",
  stamp = "2026-11-13T00:00:00Z";
let counter = 0;
const key = () =>
  "77777777-7777-4777-8777-" + String(++counter).padStart(12, "0");
async function identity(id = owner, aal = "aal2") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({
      sub: id,
      session_id: id === owner ? ownerSid : id === admin ? adminSid : viewerSid,
      aal,
      role: "authenticated",
    }),
  ]);
  await db.exec("set role authenticated");
}
async function service() {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ role: "service_role" }),
  ]);
  await db.exec("set role service_role");
}
async function root() {
  await db.exec("reset role");
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
  await db.query("insert into auth.users values($1),($2),($3)", [
    owner,
    admin,
    viewer,
  ]);
  await db.query(
    "insert into public.users(id,email,display_name,role) values($1,'owner@example.test','Synthetic Owner','OWNER'),($2,'admin@example.test','Synthetic Admin','ADMIN'),($3,'viewer@example.test','Synthetic Assigned Support','SUPPORT_AGENT')",
    [owner, admin, viewer],
  );
  await db.query(
    "insert into public.employee_sessions(id,user_id) values($1,$2),($3,$4),($5,$6)",
    [ownerSid, owner, adminSid, admin, viewerSid, viewer],
  );
}, 30000);
afterAll(async () => {
  await db?.close();
});

it("gives the Owner every new tool and limits account availability to that role", async () => {
  await identity();
  for (const permission of [
    "seller.read",
    "seller.manage",
    "notifications.read",
    "notifications.manage",
    "reports.export",
  ])
    expect(
      (
        await db.query<{ allowed: boolean }>(
          "select public.has_permission($1) as allowed",
          [permission],
        )
      ).rows[0].allowed,
    ).toBe(true);
  await identity(admin);
  expect(
    (
      await db.query<{ allowed: boolean }>(
        "select public.has_permission('seller.manage') as allowed",
      )
    ).rows[0].allowed,
  ).toBe(false);
  await expect(
    db.query(
      "select public.begin_seller_action('seller.online',null,'Synthetic account availability change',$1)",
      [key()],
    ),
  ).rejects.toThrow(/MFA and Seller permission/);
  await identity(owner, "aal1");
  await expect(
    db.query(
      "select public.begin_seller_action('seller.offline',null,'Synthetic account availability change',$1)",
      [key()],
    ),
  ).rejects.toThrow();
});
it("claims a Seller action once, recovers its key and holds uncertain account changes", async () => {
  await identity();
  const request = key();
  const parameters = [
    "seller.online",
    null,
    "Synthetic exact account command",
    request,
  ];
  const first = (
    await db.query<{ value: { claimed: boolean; operation: { id: string } } }>(
      "select public.begin_seller_action($1,$2,$3,$4) as value",
      parameters,
    )
  ).rows[0].value;
  expect(first.claimed).toBe(true);
  const replay = (
    await db.query<{ value: { claimed: boolean } }>(
      "select public.begin_seller_action($1,$2,$3,$4) as value",
      parameters,
    )
  ).rows[0].value;
  expect(replay.claimed).toBe(false);
  await expect(
    db.query(
      "select public.begin_seller_action('seller.offline',null,'Synthetic other account command',$1)",
      [key()],
    ),
  ).rejects.toThrow();
  await service();
  await db.query("select public.authorize_seller_action($1)", [
    first.operation.id,
  ]);
  await db.query(
    "select public.finish_seller_action($1,'unknown','ELDORADO_WRITE_UNKNOWN')",
    [first.operation.id],
  );
  await identity();
  await expect(
    db.query(
      "select public.begin_seller_action('seller.offline',null,'Synthetic other account command',$1)",
      [key()],
    ),
  ).rejects.toThrow();
  await expect(
    db.query(
      "select public.record_seller_manual_check($1,'Checked actual state directly on Eldorado')",
      [first.operation.id],
    ),
  ).rejects.toThrow(/request window/);
  await root();
  await db.query(
    "update public.seller_actions set created_at=now()-interval '2 minutes' where id=$1",
    [first.operation.id],
  );
  await identity();
  await db.query(
    "select public.record_seller_manual_check($1,'Checked actual state directly on Eldorado')",
    [first.operation.id],
  );
  expect(
    (
      await db.query<{ status: string }>(
        "select status from public.seller_actions where id=$1",
        [first.operation.id],
      )
    ).rows[0].status,
  ).toBe("manually_checked");
});
it("serializes mark-all and individual notification requests and denies revoked authority", async () => {
  await identity(admin);
  const first = (
    await db.query<{ value: { operation: { id: string } } }>(
      "select public.begin_seller_action('notifications.read_all',null,'Reviewed all notification read states',$1) as value",
      [key()],
    )
  ).rows[0].value;
  await expect(
    db.query(
      "select public.begin_seller_action('notification.read','fixture','Reviewed this notification read state',$1)",
      [key()],
    ),
  ).rejects.toThrow(/Reconcile/);
  await root();
  await db.query(
    "update public.employee_sessions set revoked_at=now() where id=$1",
    [adminSid],
  );
  await service();
  await expect(
    db.query("select public.authorize_seller_action($1)", [first.operation.id]),
  ).rejects.toThrow(/authority revoked/);
  await db.query(
    "select public.finish_seller_action($1,'rejected','ELDORADO_WRITE_NOT_SENT')",
    [first.operation.id],
  );
  await root();
  await db.query(
    "update public.employee_sessions set revoked_at=null where id=$1",
    [adminSid],
  );
});
it("requires full order visibility and MFA before recording report exports", async () => {
  await identity(viewer);
  await expect(
    db.query(
      "select public.record_report_export('orders','2026-11-01','2026-11-13',100)",
    ),
  ).rejects.toThrow();
  await identity();
  await db.query(
    "select public.record_report_export('orders','2026-11-01','2026-11-13',100)",
  );
  await expect(
    db.query(
      "select public.record_report_export('orders','2026-11-13','2026-11-01',100)",
    ),
  ).rejects.toThrow(/Invalid report/);
});
async function batchPair() {
  await root();
  const ids = [key(), key()];
  for (const id of ids)
    await db.query(
      "insert into public.offers(id,native_id,source,category,title,state,price,currency,quantity,updated_at) values($1,$2,'predefined','Currency','Synthetic batch listing','Active',2,'USD',10,$3)",
      ["predefined:" + id, id, stamp],
    );
  const items = ids.map((id) => ({
    target: "predefined:" + id,
    title: "Synthetic batch listing",
    expectedSnapshot: stamp,
    before: { id, state: "Active", price: 2, currency: "USD", quantity: 10 },
    change: { kind: "offer.quantity", body: 5 },
  }));
  const preview = (
    await db.query<{ id: string }>(
      "insert into public.offer_batch_previews(created_by,items) values($1,$2) returning id",
      [owner, JSON.stringify(items)],
    )
  ).rows[0].id;
  return { ids, preview };
}
it("creates exact per-listing review requests atomically and recovers without duplicates", async () => {
  const { preview } = await batchPair();
  await identity();
  const request = key();
  const first = (
    await db.query<{ value: { ids: string[]; reused: boolean } }>(
      "select public.request_offer_batch($1,'Reviewed each exact batch quantity',$2) as value",
      [preview, request],
    )
  ).rows[0].value;
  expect(first.ids).toHaveLength(2);
  expect(first.reused).toBe(false);
  const again = (
    await db.query<{ value: { ids: string[]; reused: boolean } }>(
      "select public.request_offer_batch($1,'Reviewed each exact batch quantity',$2) as value",
      [preview, request],
    )
  ).rows[0].value;
  expect(again.ids).toEqual(first.ids);
  expect(again.reused).toBe(true);
  await expect(
    db.query(
      "select public.request_offer_batch($1,'Reviewed each exact batch quantity',$2)",
      [preview, key()],
    ),
  ).rejects.toThrow(/already submitted/);
});
it("rolls back the whole ticket set when one selected listing changed", async () => {
  const { preview, ids } = await batchPair();
  await root();
  await db.query("update public.offers set updated_at=now() where id=$1", [
    "predefined:" + ids[1],
  ]);
  await identity();
  await expect(
    db.query(
      "select public.request_offer_batch($1,'Reviewed each exact batch quantity',$2)",
      [preview, key()],
    ),
  ).rejects.toThrow();
  const rows = await db.query(
    "select id from public.approval_requests where target_id=any($1::text[])",
    [ids.map((id) => "predefined:" + id)],
  );
  expect(rows.rows).toHaveLength(0);
});
it("blocks expired previews, another employee and permissions removed after preview", async () => {
  const { preview } = await batchPair();
  await identity(admin);
  await expect(
    db.query(
      "select public.request_offer_batch($1,'Reviewed each exact batch quantity',$2)",
      [preview, key()],
    ),
  ).rejects.toThrow(/not accessible/);
  await root();
  await db.query(
    "update public.offer_batch_previews set expires_at=now()-interval '1 minute' where id=$1",
    [preview],
  );
  await identity();
  await expect(
    db.query(
      "select public.request_offer_batch($1,'Reviewed each exact batch quantity',$2)",
      [preview, key()],
    ),
  ).rejects.toThrow(/expired/);
  const second = await batchPair();
  await root();
  await db.query(
    "insert into public.user_permission_overrides(user_id,permission,allowed) values($1,'offers.update_stock',false)",
    [owner],
  );
  await identity();
  await expect(
    db.query(
      "select public.request_offer_batch($1,'Reviewed each exact batch quantity',$2)",
      [second.preview, key()],
    ),
  ).rejects.toThrow(/Permission denied/);
  await root();
  await db.query(
    "delete from public.user_permission_overrides where user_id=$1 and permission='offers.update_stock'",
    [owner],
  );
});
it("supports 15-second precise rules but rejects unrepresentable undercuts", async () => {
  const { ids } = await batchPair();
  await identity();
  await db.query(
    "select public.save_repricing_policy($1,1,0.00001,5,'simulation',15,false)",
    ["predefined:" + ids[0]],
  );
  await expect(
    db.query(
      "select public.save_repricing_policy($1,1,0.00001,2,'simulation',15,false)",
      ["predefined:" + ids[0]],
    ),
  ).rejects.toThrow(/precision/);
  await expect(
    db.query(
      "select public.save_repricing_policy($1,1,0.00001,5,'simulation',14,false)",
      ["predefined:" + ids[0]],
    ),
  ).rejects.toThrow();
});
it("keeps new private stores and completion helpers out of browser roles", async () => {
  await root();
  for (const role of ["anon", "authenticated"]) {
    expect(
      (
        await db.query<{ allowed: boolean }>(
          "select has_function_privilege($1,'public.finish_seller_action(uuid,text,text)','EXECUTE') as allowed",
          [role],
        )
      ).rows[0].allowed,
    ).toBe(false);
    expect(
      (
        await db.query<{ allowed: boolean }>(
          "select has_function_privilege($1,'public.authorize_seller_action(uuid)','EXECUTE') as allowed",
          [role],
        )
      ).rows[0].allowed,
    ).toBe(false);
    expect(
      (
        await db.query<{ allowed: boolean }>(
          "select has_table_privilege($1,'public.offer_batch_previews','INSERT') as allowed",
          [role],
        )
      ).rows[0].allowed,
    ).toBe(false);
  }
  expect(
    (
      await db.query<{ count: number }>(
        "select count(*)::integer as count from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and has_function_privilege('anon',p.oid,'EXECUTE')",
      )
    ).rows[0].count,
  ).toBe(0);
});
