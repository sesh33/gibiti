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
async function listing() {
  await root();
  const id = key();
  await db.query(
    "insert into public.offers(id,native_id,source,category,title,state,price,currency,quantity,updated_at) values($1,$2,'predefined','Currency','Synthetic listing','Active',2,'USD',10,$3)",
    ["predefined:" + id, id, stamp],
  );
  await identity();
  return id;
}
async function rule(
  native: string,
  mode = "simulation",
  floor = 1.5,
  confirm = mode === "automatic",
) {
  const result = await db.query<{ policy: Record<string, unknown> }>(
    "select public.save_repricing_policy($1,$2,0.02,2,$3,300,$4) as policy",
    ["predefined:" + native, floor, mode, confirm],
  );
  return result.rows[0].policy;
}
async function approve(policy: Record<string, unknown>, aal = "aal2") {
  await identity(admin, aal);
  await db.query(
    "select public.review_repricing_policy($1,$2,true,'Independent scoped pricing review')",
    [policy.id, policy.version],
  );
}
async function workspace(
  poll = false,
  delivery = false,
  pricing = false,
  confirm = true,
) {
  await identity();
  return db.query("select public.save_workspace_preferences($1,60,$2,$3,$4)", [
    poll,
    delivery,
    pricing,
    confirm,
  ]);
}
async function quote(policy: Record<string, unknown>, amount = 1.8) {
  await root();
  const id = key();
  await db.query(
    "insert into public.repricing_quotes(id,policy_id,policy_version,requested_by,amount,currency,before_snapshot,proof) values($1,$2,$3,$4,$5,'USD',$6,'{\"complete\":true}')",
    [
      id,
      policy.id,
      policy.version,
      owner,
      amount,
      JSON.stringify({
        id: policy.native_id,
        state: "Active",
        price: 2,
        currency: "USD",
        quantity: 10,
      }),
    ],
  );
  return id;
}
async function priceRequest(
  native: string,
  amount: number,
  kind = "offer.price",
) {
  const change =
    kind === "offer.price"
      ? { kind, body: { amount, currency: "USD" } }
      : {
          kind,
          body: {
            details: { pricing: { pricePerUnit: { amount, currency: "USD" } } },
            augmentedGame: {},
            giftCardDetails: null,
          },
        };
  return db.query(
    "select public.request_marketplace_operation($1,$2,$3,$4,'Reviewed explicit price change',$5)",
    [
      JSON.stringify(change),
      "predefined:" + native,
      stamp,
      JSON.stringify({
        id: native,
        state: "Active",
        price: 2,
        currency: "USD",
        quantity: 10,
      }),
      key(),
    ],
  );
}
it("starts disabled and blocks background activation before hosted proof", async () => {
  await root();
  expect(
    (
      await db.query<{
        poll_enabled: boolean;
        auto_delivery_enabled: boolean;
        auto_pricing_enabled: boolean;
      }>(
        "select poll_enabled,auto_delivery_enabled,auto_pricing_enabled from public.workspace_preferences",
      )
    ).rows[0],
  ).toEqual({
    poll_enabled: false,
    auto_delivery_enabled: false,
    auto_pricing_enabled: false,
  });
  await expect(workspace(true)).rejects.toThrow("scheduler");
  await root();
  await db.exec(
    "update public.automation_runtime set scheduler_configured=true,worker_origin='https://rivox.example'",
  );
  await expect(workspace(true)).rejects.toThrow("Verify the connection");
  await root();
  await db.query(
    "insert into public.integration_credentials(provider,client_id,encrypted_secret,updated_by,verified_origin) values('eldorado','fixture-client','v1.synthetic-encrypted-secret',$1,'https://rivox.example')",
    [owner],
  );
  await workspace(true);
  await root();
  expect(
    (
      await db.query<{ count: number }>(
        "select count(*)::integer as count from public.employee_sessions where session_kind='automation' and revoked_at is null",
      )
    ).rows[0].count,
  ).toBe(1);
  await workspace();
});
it("persists private per-user read preferences and enforces scope", async () => {
  await identity();
  await db.query("select public.save_staff_preferences(true,120)");
  await identity(viewer);
  expect(
    (await db.query("select * from public.staff_preferences")).rows,
  ).toHaveLength(0);
  await expect(
    db.query("select public.save_staff_preferences(true,60)"),
  ).rejects.toThrow("Polling permission");
  await db.query("select public.save_staff_preferences(false,60)");
  await identity();
  expect(
    (
      await db.query<{ order_poll_seconds: number }>(
        "select order_poll_seconds from public.staff_preferences",
      )
    ).rows[0].order_poll_seconds,
  ).toBe(120);
});
it("enforces the floor on ordinary price and full-details requests", async () => {
  const id = await listing();
  await rule(id);
  await expect(priceRequest(id, 1.49)).rejects.toThrow(
    "configured currency or floor",
  );
  await expect(priceRequest(id, 1.49, "offer.details")).rejects.toThrow(
    "configured currency or floor",
  );
  await expect(
    db.query(
      "select public.request_marketplace_operation($1,$2,$3,$4,'Reviewed explicit currency change',$5)",
      [
        JSON.stringify({
          kind: "offer.price",
          body: { amount: 2, currency: "EUR" },
        }),
        "predefined:" + id,
        stamp,
        JSON.stringify({ id, state: "Active" }),
        key(),
      ],
    ),
  ).rejects.toThrow("configured currency or floor");
});
it("requires explicit automatic activation and independent MFA review", async () => {
  const id = await listing();
  await expect(rule(id, "automatic", 1.5, false)).rejects.toThrow(
    "Explicit automatic activation",
  );
  const policy = await rule(id, "automatic");
  await expect(
    db.query(
      "select public.review_repricing_policy($1,$2,true,'Self review')",
      [policy.id, policy.version],
    ),
  ).rejects.toThrow("Independent MFA");
  await expect(approve(policy, "aal1")).rejects.toThrow("Independent MFA");
  await approve(policy);
  await identity();
  await expect(workspace(false, false, true, false)).rejects.toThrow(
    "Explicit automation",
  );
  await workspace(false, false, true, true);
  await service();
  const checked = await db.query<{ ok: boolean }>(
    "select public.automatic_policy_authorized($1,$2) as ok",
    [policy.id, policy.version],
  );
  expect(checked.rows[0].ok).toBe(true);
  await workspace();
});
it("uses immutable expiring manual quotes rather than arbitrary browser amounts", async () => {
  const id = await listing(),
    policy = await rule(id, "manual"),
    qid = await quote(policy);
  await identity();
  const result = await db.query<{ id: string }>(
    "select public.request_quoted_repricing($1,'Confirm exact simulated price',$2) as id",
    [qid, key()],
  );
  const ticket = (
    await db.query<{
      repricing_quote_id: string;
      payload: { change: { body: { amount: number } } };
    }>(
      "select repricing_quote_id,payload from public.approval_requests where id=$1",
      [result.rows[0].id],
    )
  ).rows[0];
  expect(ticket.repricing_quote_id).toBe(qid);
  expect(ticket.payload.change.body.amount).toBe(1.8);
  await identity(admin);
  await db.query(
    "select public.decide_approval($1,false,'Conclude synthetic test')",
    [result.rows[0].id],
  );
  await root();
  await db.query(
    "update public.repricing_quotes set expires_at=now()-interval '1 second' where id=$1",
    [qid],
  );
  await identity();
  await expect(
    db.query(
      "select public.request_quoted_repricing($1,'Confirm exact simulated price',$2)",
      [qid, key()],
    ),
  ).rejects.toThrow("expired");
});
it("only the hosted service can claim approved automatic tickets once", async () => {
  const id = await listing(),
    policy = await rule(id, "automatic");
  await approve(policy);
  await workspace(false, false, true);
  const qid = await quote(policy);
  await service();
  const plan = (
    await db.query<{ plan: { lease: string } }>(
      "select public.claim_automation_tick() as plan",
    )
  ).rows[0].plan;
  expect(plan).not.toBeNull();
  const ticket = (
    await db.query<{ ticket: { id: string } }>(
      "select public.begin_automatic_repricing($1,$2) as ticket",
      [qid, plan.lease],
    )
  ).rows[0].ticket;
  await identity();
  await expect(
    db.query("select public.claim_marketplace_operation($1)", [ticket.id]),
  ).rejects.toThrow("hosted runner owns");
  await service();
  await db.query("select public.claim_automated_operation($1,$2)", [
    ticket.id,
    plan.lease,
  ]);
  await expect(
    db.query("select public.claim_automated_operation($1,$2)", [
      ticket.id,
      plan.lease,
    ]),
  ).rejects.toThrow("already claimed");
  await db.query(
    "select public.finish_marketplace_operation($1,'succeeded',$2,null)",
    [
      ticket.id,
      JSON.stringify({
        verified: true,
        id,
        state: "Active",
        price: 1.8,
        currency: "USD",
        quantity: 10,
      }),
    ],
  );
  await db.query("select public.release_automation_tick($1,null,60)", [
    plan.lease,
  ]);
  await workspace();
});
it("stop switches revoke unclaimed work and release obsolete target locks", async () => {
  const id = await listing(),
    policy = await rule(id, "automatic");
  await approve(policy);
  await workspace(false, false, true);
  const qid = await quote(policy);
  await service();
  const plan = (
    await db.query<{ plan: { lease: string } }>(
      "select public.claim_automation_tick() as plan",
    )
  ).rows[0].plan;
  const ticket = (
    await db.query<{ ticket: { id: string } }>(
      "select public.begin_automatic_repricing($1,$2) as ticket",
      [qid, plan.lease],
    )
  ).rows[0].ticket;
  await workspace();
  await service();
  await expect(
    db.query("select public.claim_automated_operation($1,$2)", [
      ticket.id,
      plan.lease,
    ]),
  ).rejects.toThrow("disabled or changed");
  await db.query("select public.cancel_stale_automatic_tickets()");
  expect(
    (
      await db.query<{ status: string }>(
        "select status from public.approval_requests where id=$1",
        [ticket.id],
      )
    ).rows[0].status,
  ).toBe("rejected");
  await db.query("select public.release_automation_tick($1,null,60)", [
    plan.lease,
  ]);
  await identity();
  await rule(id, "manual", 1.6);
});
it("automatic delivery requires completed-transfer attestation plus independent approval", async () => {
  await workspace(false, true, false);
  await root();
  const order = key();
  await db.query(
    "insert into public.orders(id,buyer_username,quantity,amount,currency,state,product_title,purchased_at,synced_at) values($1,'Synthetic Buyer',1,1,'USD','Paid','Fixture',$2,$2)",
    [order, stamp],
  );
  const parameters = () => [
    JSON.stringify({ kind: "order.deliver" }),
    order,
    stamp,
    JSON.stringify({ id: order, state: "Paid", deliveryTime: null }),
    "Actual transfer verified for this order",
    key(),
    false,
  ];
  await identity();
  await expect(
    db.query(
      "select public.request_marketplace_with_delivery_optin($1,$2,$3,$4,$5,$6,$7)",
      parameters(),
    ),
  ).rejects.toThrow("Verified delivery");
  const p = parameters();
  p[6] = true as never;
  const ticket = (
    await db.query<{ id: string }>(
      "select public.request_marketplace_with_delivery_optin($1,$2,$3,$4,$5,$6,$7) as id",
      p,
    )
  ).rows[0].id;
  await identity(admin);
  await db.query(
    "select public.decide_approval($1,true,'Reviewed actual fulfillment')",
    [ticket],
  );
  await service();
  const plan = (
    await db.query<{ plan: { lease: string } }>(
      "select public.claim_automation_tick() as plan",
    )
  ).rows[0].plan;
  await db.query("select public.claim_automated_operation($1,$2)", [
    ticket,
    plan.lease,
  ]);
  await db.query(
    "select public.finish_marketplace_operation($1,'succeeded',$2,null)",
    [
      ticket,
      JSON.stringify({
        id: order,
        state: "Delivered",
        deliveryTime: null,
        verified: true,
      }),
    ],
  );
  await db.query("select public.release_automation_tick($1,null,60)", [
    plan.lease,
  ]);
  await root();
  await db.query(
    "update public.orders set state='Paid',synced_at=$2 where id=$1",
    [order, stamp],
  );
  await identity();
  const again = parameters();
  again[6] = true as never;
  await expect(
    db.query(
      "select public.request_marketplace_with_delivery_optin($1,$2,$3,$4,$5,$6,$7)",
      again,
    ),
  ).rejects.toThrow("already recorded");
  await workspace();
});
it("leases and provider backoff survive invocations and cannot be shortened", async () => {
  await workspace(true);
  await service();
  const plan = (
    await db.query<{ plan: { lease: string } }>(
      "select public.claim_automation_tick() as plan",
    )
  ).rows[0].plan;
  expect(plan).not.toBeNull();
  expect(
    (
      await db.query<{ plan: unknown }>(
        "select public.claim_automation_tick() as plan",
      )
    ).rows[0].plan,
  ).toBeNull();
  await db.query(
    "select public.release_automation_tick($1,'ELDORADO_RATE_LIMITED',3600)",
    [plan.lease],
  );
  expect(
    (
      await db.query<{ ok: boolean }>(
        "select backoff_until>now()+interval '59 minutes' as ok from public.automation_runtime",
      )
    ).rows[0].ok,
  ).toBe(true);
  await db.query(
    "select public.defer_eldorado_requests(now()+interval '1 hour')",
  );
  await db.query(
    "select public.defer_eldorado_requests(now()+interval '1 minute')",
  );
  expect(
    (
      await db.query<{ ok: boolean }>(
        "select not_before>now()+interval '59 minutes' as ok from public.integration_rate_state",
      )
    ).rows[0].ok,
  ).toBe(true);
  await identity();
  await expect(
    db.query("select public.defer_eldorado_requests(now())"),
  ).rejects.toThrow("permission denied");
});
it("keeps worker state, shared backoff, verification and completion RPCs private", async () => {
  await root();
  for (const role of ["anon", "authenticated"]) {
    const result = await db.query<{
      runtime: boolean;
      rate: boolean;
      worker: boolean;
      complete: boolean;
      proof: boolean;
    }>(
      `select has_table_privilege('${role}','public.automation_runtime','SELECT') as runtime,has_table_privilege('${role}','public.integration_rate_state','SELECT') as rate,has_function_privilege('${role}','public.claim_automated_operation(uuid,uuid)','EXECUTE') as worker,has_function_privilege('${role}','public.release_automation_tick(uuid,text,integer)','EXECUTE') as complete,has_function_privilege('${role}','public.verify_seller_connection(uuid,uuid,text)','EXECUTE') as proof`,
    );
    expect(result.rows[0]).toEqual({
      runtime: false,
      rate: false,
      worker: false,
      complete: false,
      proof: false,
    });
  }
});
