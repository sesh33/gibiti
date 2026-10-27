import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { rolePermissions } from "@/domains/authorization/permissions";
let db: PGlite;
const ids = {
  admin: "abababab-abab-4bab-8bab-abababababab",
  owner: "11111111-1111-4111-8111-111111111111",
  agent: "22222222-2222-4222-8222-222222222222",
  viewer: "33333333-3333-4333-8333-333333333333",
  supervisor: "44444444-4444-4444-8444-444444444444",
  order: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  otherOrder: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  session: "55555555-5555-4555-8555-555555555555",
  item: "66666666-6666-4666-8666-666666666666",
};
async function identity(user = ids.agent, aal = "aal1", session = ids.session) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: user, aal, session_id: session }),
  ]);
  await db.exec("set role authenticated");
  await db.query("select public.register_employee_session()");
}
async function reset() {
  await db.exec("reset role");
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;grant usage on schema auth to authenticated;grant execute on all functions in schema auth to authenticated;`,
  );
  // pgcrypto's gen_random_uuid is built into modern PostgreSQL; PGlite does not ship that extension.
  const migration = readFileSync(
    "supabase/migrations/202610270001_foundation.sql",
    "utf8",
  ).replace("create extension if not exists pgcrypto;", "");
  await db.exec(migration);
  for (const filename of readdirSync("supabase/migrations")
    .filter((name) => name.endsWith(".sql") && !name.includes("0001_"))
    .sort())
    await db.exec(readFileSync("supabase/migrations/" + filename, "utf8"));
  for (const [name, role] of [
    ["admin", "ADMIN"],
    ["owner", "OWNER"],
    ["agent", "SUPPORT_AGENT"],
    ["viewer", "VIEWER"],
    ["supervisor", "SUPERVISOR"],
  ] as const) {
    await db.query("insert into auth.users values($1)", [ids[name]]);
    await db.query(
      "insert into public.users(id,email,display_name,role) values($1,$2,$3,$4)",
      [ids[name], `${name}@example.test`, name, role],
    );
  }
  for (const id of [ids.order, ids.otherOrder])
    await db.query(
      "insert into public.orders(id,buyer_username,quantity,amount,currency,state,product_title,purchased_at) values($1,'Synthetic',1,10,'USD','Paid','Synthetic product',now())",
      [id],
    );
  await db.query(
    "insert into public.order_assignments(order_id,user_id,assigned_by) values($1,$2,$3)",
    [ids.order, ids.agent, ids.owner],
  );
  await db.query(
    "insert into public.inventory_items(id,sku,title,category) values($1,'FIXTURE','Synthetic item','Roblox')",
    [ids.item],
  );
});
afterAll(async () => {
  await db?.close();
});
it("SQL role defaults agree with the application catalog", async () => {
  await reset();
  for (const [role, permissions] of Object.entries(rolePermissions)) {
    const result = await db.query<{ permission: string }>(
      "select permission from public.role_permissions where role=$1",
      [role],
    );
    expect(result.rows.map((row) => row.permission).sort()).toEqual(
      [...permissions].sort(),
    );
  }
});
it("RLS allows only assigned orders for a support agent", async () => {
  await identity();
  const result = await db.query<{ id: string }>("select id from public.orders");
  expect(result.rows).toEqual([{ id: ids.order }]);
});
it("direct API-equivalent writes cannot grant permissions or forge audit", async () => {
  await identity();
  await expect(
    db.query("update public.users set role='OWNER' where id=$1", [ids.agent]),
  ).rejects.toThrow();
  await expect(
    db.query(
      "insert into public.audit_logs(action,target_type) values('forged','test')",
    ),
  ).rejects.toThrow();
  await expect(
    db.query("select public.audit_event('forged','test','x','{}')"),
  ).rejects.toThrow();
});
it("RLS blocks an Owner without MFA and permits the same Owner with aal2", async () => {
  await identity(ids.owner, "aal1", "77777777-7777-4777-8777-777777777777");
  expect((await db.query("select id from public.orders")).rows).toHaveLength(0);
  await identity(ids.owner, "aal2", "77777777-7777-4777-8777-777777777777");
  expect((await db.query("select id from public.orders")).rows).toHaveLength(2);
});
it("a viewer cannot create notes or approve operations", async () => {
  await identity(ids.viewer, "aal1", "88888888-8888-4888-8888-888888888888");
  await expect(
    db.query("select public.add_internal_note($1,$2)", [
      ids.order,
      "forbidden",
    ]),
  ).rejects.toThrow("Access denied");
  await expect(
    db.query("select public.request_approval($1,$2,$3,$4)", [
      "orders.cancel",
      ids.order,
      "Synthetic cancellation reason",
      "99999999-9999-4999-8999-999999999999",
    ]),
  ).rejects.toThrow("Access denied");
});
it("creates idempotent approval requests, prevents self approval, and records a distinct reviewer", async () => {
  await identity(
    ids.supervisor,
    "aal1",
    "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  );
  const args = [
    "orders.cancel",
    ids.order,
    "Synthetic cancellation reason",
    "99999999-9999-4999-8999-999999999999",
  ];
  const first = await db.query<{ request_approval: string }>(
    "select public.request_approval($1,$2,$3,$4)",
    args,
  );
  const second = await db.query<{ request_approval: string }>(
    "select public.request_approval($1,$2,$3,$4)",
    args,
  );
  expect(second.rows).toEqual(first.rows);
  const approval = first.rows[0].request_approval;
  await expect(
    db.query("select public.decide_approval($1,true,$2)", [
      approval,
      "Self decision",
    ]),
  ).rejects.toThrow("Access denied");
  await identity(ids.owner, "aal2", "77777777-7777-4777-8777-777777777777");
  await db.query("select public.decide_approval($1,true,$2)", [
    approval,
    "Verified request",
  ]);
  expect(
    (
      await db.query<{ status: string }>(
        "select status from public.approval_requests where id=$1",
        [approval],
      )
    ).rows[0].status,
  ).toBe("approved");
  await expect(
    db.query("select public.decide_approval($1,true,$2)", [
      approval,
      "Duplicate decision",
    ]),
  ).rejects.toThrow("already decided");
});
it("prevents duplicate inventory allocation and produces an audit record", async () => {
  await identity(ids.owner, "aal2", "77777777-7777-4777-8777-777777777777");
  await db.query("select public.reserve_inventory($1,$2)", [
    ids.item,
    ids.order,
  ]);
  await expect(
    db.query("select public.reserve_inventory($1,$2)", [
      ids.item,
      ids.otherOrder,
    ]),
  ).rejects.toThrow("not available");
  expect(
    (
      await db.query(
        "select id from public.audit_logs where action='inventory.reserved'",
      )
    ).rows,
  ).toHaveLength(1);
});
it("permission changes revoke active sessions and cannot target the Owner or self", async () => {
  await identity(ids.owner, "aal2", "77777777-7777-4777-8777-777777777777");
  await expect(
    db.query("select public.manage_staff($1,$2,true,$3)", [
      ids.owner,
      "VIEWER",
      "[]",
    ]),
  ).rejects.toThrow();
  await db.query("select public.revoke_staff_sessions($1)", [ids.agent]);
  await identity();
  expect(
    (
      await db.query<{ register_employee_session: boolean }>(
        "select public.register_employee_session()",
      )
    ).rows[0].register_employee_session,
  ).toBe(false);
  expect((await db.query("select id from public.orders")).rows).toHaveLength(0);
});
it("a failed order page rolls back inserts and synchronization metadata", async () => {
  await reset();
  await db.exec("set role service_role");
  const record = {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    buyer_username: "Synthetic",
    quantity: 1,
    amount: 10,
    currency: "USD",
    state: "Paid",
    product_title: "Synthetic",
    purchased_at: "2026-10-27T12:00:00Z",
    synced_at: "2026-10-27T12:00:00Z",
    details: {},
  };
  await expect(
    db.query("select public.persist_order_page($1,$2,null,$3,$4)", [
      JSON.stringify([record]),
      JSON.stringify([
        {
          order_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          state: "Paid",
          occurred_at: "2026-10-27T12:00:00Z",
        },
      ]),
      ids.owner,
      "77777777-7777-4777-8777-777777777777",
    ]),
  ).rejects.toThrow("foreign key");
  await reset();
  expect(
    (await db.query("select id from public.orders where id=$1", [record.id]))
      .rows,
  ).toHaveLength(0);
});

it("applies an access change only after approval by a different MFA-verified reviewer", async () => {
  await identity(ids.owner, "aal2", "77777777-7777-4777-8777-777777777777");
  const request = await db.query<{ request_staff_access_change: string }>(
    "select public.request_staff_access_change($1,$2,true,$3,$4,$5)",
    [
      ids.viewer,
      "SUPPORT_AGENT",
      "[]",
      "Synthetic role change request",
      "adadadad-adad-4dad-8dad-adadadadadad",
    ],
  );
  const approval = request.rows[0].request_staff_access_change;
  await expect(
    db.query("select public.decide_approval($1,true,$2)", [
      approval,
      "Requester cannot approve",
    ]),
  ).rejects.toThrow("Access denied");
  await identity(ids.admin, "aal1", "abababab-abab-4bab-8bab-abababababab");
  await expect(
    db.query("select public.decide_approval($1,true,$2)", [
      approval,
      "Missing MFA",
    ]),
  ).rejects.toThrow("Access denied");
  await identity(ids.admin, "aal2", "abababab-abab-4bab-8bab-abababababab");
  await db.query("select public.decide_approval($1,true,$2)", [
    approval,
    "Verified role change",
  ]);
  await reset();
  expect(
    (
      await db.query<{ role: string }>(
        "select role from public.users where id=$1",
        [ids.viewer],
      )
    ).rows[0].role,
  ).toBe("SUPPORT_AGENT");
  expect(
    (
      await db.query<{ status: string }>(
        "select status from public.approval_requests where id=$1",
        [approval],
      )
    ).rows[0].status,
  ).toBe("succeeded");
  expect(
    (
      await db.query(
        "select id from public.employee_sessions where user_id=$1 and revoked_at is null",
        [ids.viewer],
      )
    ).rows,
  ).toHaveLength(0);
});

it("audits secret access while denying raw reads and default Admin access", async () => {
  await reset();
  await db.query(
    "insert into public.inventory_secrets(item_id,encrypted_payload) values($1,$2)",
    [ids.item, "v1.YQ==.Yg==.Yw=="],
  );
  await identity(ids.admin, "aal2", "abababab-abab-4bab-8bab-abababababab");
  await expect(
    db.query("select public.access_inventory_secret($1)", [ids.item]),
  ).rejects.toThrow("Access denied");
  await identity(ids.owner, "aal2", "77777777-7777-4777-8777-777777777777");
  await expect(
    db.query("select * from public.inventory_secrets"),
  ).rejects.toThrow();
  expect(
    (
      await db.query<{ access_inventory_secret: string }>(
        "select public.access_inventory_secret($1)",
        [ids.item],
      )
    ).rows[0].access_inventory_secret,
  ).toBe("v1.YQ==.Yg==.Yw==");
  expect(
    (
      await db.query(
        "select id from public.audit_logs where action='inventory.secret_accessed'",
      )
    ).rows,
  ).toHaveLength(1);
});
it("releases a reservation and requires a distinct reviewer for internal consumption", async () => {
  await identity(ids.owner, "aal2", "77777777-7777-4777-8777-777777777777");
  const reservation = (
    await db.query<{ id: string }>(
      "select id from public.inventory_reservations where item_id=$1 and released_at is null",
      [ids.item],
    )
  ).rows[0].id;
  await db.query("select public.finish_inventory_reservation($1,false,$2)", [
    reservation,
    "Synthetic release",
  ]);
  expect(
    (
      await db.query<{ status: string }>(
        "select status from public.inventory_items where id=$1",
        [ids.item],
      )
    ).rows[0].status,
  ).toBe("available");
  const next = (
    await db.query<{ reserve_inventory: string }>(
      "select public.reserve_inventory($1,$2)",
      [ids.item, ids.order],
    )
  ).rows[0].reserve_inventory;
  await expect(
    db.query("select public.finish_inventory_reservation($1,true,$2)", [
      next,
      "Unreviewed consumption",
    ]),
  ).rejects.toThrow("requires approval");
  const approval = (
    await db.query<{ request_inventory_consumption: string }>(
      "select public.request_inventory_consumption($1,$2,$3)",
      [
        next,
        "Synthetic consumption request",
        "fafafafa-fafa-4afa-8afa-fafafafafafa",
      ],
    )
  ).rows[0].request_inventory_consumption;
  await expect(
    db.query("select public.decide_approval($1,true,$2)", [
      approval,
      "Self review",
    ]),
  ).rejects.toThrow("Access denied");
  await identity(ids.admin, "aal2", "abababab-abab-4bab-8bab-abababababab");
  await db.query("select public.decide_approval($1,true,$2)", [
    approval,
    "Verified internal stock usage",
  ]);
  expect(
    (
      await db.query<{ status: string }>(
        "select status from public.inventory_items where id=$1",
        [ids.item],
      )
    ).rows[0].status,
  ).toBe("delivered");
  expect(
    (
      await db.query<{ state: string }>(
        "select state from public.orders where id=$1",
        [ids.order],
      )
    ).rows[0].state,
  ).toBe("Paid");
  expect(
    (
      await db.query(
        "select id from public.inventory_movements where item_id=$1",
        [ids.item],
      )
    ).rows.length,
  ).toBeGreaterThanOrEqual(3);
});
