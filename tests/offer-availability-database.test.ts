import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

let db: PGlite;
const owner = "11111111-1111-4111-8111-111111111111";
const admin = "22222222-2222-4222-8222-222222222222";
const viewer = "33333333-3333-4333-8333-333333333333";
const ownerSession = "44444444-4444-4444-8444-444444444444";
const adminSession = "55555555-5555-4555-8555-555555555555";
const viewerSession = "66666666-6666-4666-8666-666666666666";
const snapshot = "2026-11-02T12:00:00.000Z";
let keyCounter = 0;
function key() {
  keyCounter++;
  return "77777777-7777-4777-8777-" + String(keyCounter).padStart(12, "0");
}
async function identity(user = owner, session = ownerSession, aal = "aal2") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: user, session_id: session, aal }),
  ]);
  await db.exec("set role authenticated");
}
async function offer(name: string) {
  await db.exec("reset role");
  await db.query(
    `insert into public.offers(id,native_id,source,category,title,state,updated_at)
     values($1,$2,'items','Item','Synthetic listing','Active',$3)`,
    ["items:" + name, name, snapshot],
  );
  await identity();
  return "items:" + name;
}
type Operation = {
  id: string;
  actor_id: string;
  status: string;
  external_attempted: boolean;
};
async function begin(
  offerId: string,
  requestKey = key(),
  action = "pause",
  at = snapshot,
) {
  const result = await db.query<{
    result: { operation: Operation; reused: boolean };
  }>(
    "select public.begin_offer_availability($1,$2,$3,$4,'Reviewed listing availability') as result",
    [offerId, action, at, requestKey],
  );
  return result.rows[0].result;
}
async function finish(
  id: string,
  outcome: string,
  observed: string | null,
  failure: string | null = null,
  fresh: unknown = null,
) {
  await db.exec("reset role; set role service_role");
  try {
    const result = await db.query<{ result: Operation }>(
      "select public.finish_offer_availability($1,$2,$3,$4,$5) as result",
      [
        id,
        outcome,
        observed,
        failure,
        fresh === null ? null : JSON.stringify(fresh),
      ],
    );
    return result.rows[0].result;
  } finally {
    await db.exec("reset role");
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb
    $$;
    create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
    grant usage on schema auth to authenticated;
    grant execute on all functions in schema auth to authenticated;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
  `);
  for (const filename of readdirSync("supabase/migrations")
    .filter(
      (name) =>
        name.endsWith(".sql") && name <= "202611020014_offer_availability.sql",
    )
    .sort())
    await db.exec(
      readFileSync("supabase/migrations/" + filename, "utf8").replace(
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
    `insert into public.users(id,email,display_name,role) values
      ($1,'owner@example.test','Synthetic Owner','OWNER'),
      ($2,'admin@example.test','Synthetic Admin','ADMIN'),
      ($3,'viewer@example.test','Synthetic Viewer','VIEWER')`,
    [owner, admin, viewer],
  );
  await db.query(
    "insert into public.employee_sessions(id,user_id) values($1,$2),($3,$4),($5,$6)",
    [ownerSession, owner, adminSession, admin, viewerSession, viewer],
  );
}, 30_000);

afterAll(async () => {
  await db?.close();
});

it("explicitly protects managed-default ACLs, server completion and direct journal writes", async () => {
  for (const [role, signature, expected] of [
    [
      "anon",
      "public.begin_offer_availability(text,text,timestamptz,uuid,text)",
      false,
    ],
    [
      "authenticated",
      "public.begin_offer_availability(text,text,timestamptz,uuid,text)",
      true,
    ],
    ["authenticated", "public.assert_offer_availability_execution(uuid)", true],
    [
      "authenticated",
      "public.finish_offer_availability(uuid,text,text,text,jsonb)",
      false,
    ],
    [
      "service_role",
      "public.finish_offer_availability(uuid,text,text,text,jsonb)",
      true,
    ],
  ] as const) {
    await db.exec("reset role");
    const result = await db.query<{ allowed: boolean }>(
      "select has_function_privilege($1,$2,'EXECUTE') as allowed",
      [role, signature],
    );
    expect(result.rows[0].allowed, role + ": " + signature).toBe(expected);
  }
  await identity();
  await expect(
    db.exec("delete from public.offer_availability_operations"),
  ).rejects.toThrow(/permission denied/i);
  await expect(
    db.query(
      "select public.finish_offer_availability($1,'succeeded','Paused',null,null)",
      [key()],
    ),
  ).rejects.toThrow(/permission denied/i);
});

it("deduplicates retries, rejects changed payloads/stale snapshots and blocks another inflight request", async () => {
  const target = await offer("dedupe");
  const requestKey = key();
  const first = await begin(target, requestKey);
  const retry = await begin(target, requestKey);
  expect(first.reused).toBe(false);
  expect(retry).toEqual({ operation: first.operation, reused: true });
  await expect(begin(target, requestKey, "resume")).rejects.toThrow(
    /different request/i,
  );
  await expect(
    begin(target, key(), "pause", "2026-11-01T12:00:00Z"),
  ).rejects.toThrow(/snapshot changed/i);
  await identity(admin, adminSession);
  await expect(begin(target)).rejects.toThrow(/needs reconciliation/i);
  await db.exec("reset role");
  const audit = await db.query<{ count: number }>(
    "select count(*)::integer as count from public.audit_logs where action='offers.availability_requested' and target_id=$1",
    [target],
  );
  expect(audit.rows[0].count).toBe(1);
});

it("checks both permissions, MFA, active session and operation ownership before a single execution claim", async () => {
  const target = await offer("claims");
  const created = await begin(target);
  await identity(viewer, viewerSession);
  await expect(begin(target)).rejects.toThrow(/permission required/i);
  await identity(owner, ownerSession, "aal1");
  await expect(begin(target)).rejects.toThrow(/permission required/i);
  await identity(admin, adminSession);
  await expect(
    db.query("select public.assert_offer_availability_execution($1)", [
      created.operation.id,
    ]),
  ).rejects.toThrow(/does not belong/i);
  await identity();
  await db.query("select public.assert_offer_availability_execution($1)", [
    created.operation.id,
  ]);
  await expect(
    db.query("select public.assert_offer_availability_execution($1)", [
      created.operation.id,
    ]),
  ).rejects.toThrow(/already claimed/i);
  await db.exec("reset role");
  const status = await db.query<{ external_attempted: boolean }>(
    "select external_attempted from public.offer_availability_operations where id=$1",
    [created.operation.id],
  );
  expect(status.rows[0].external_attempted).toBe(true);
});

it("preserves unknown outcomes until the desired upstream state is actually observed", async () => {
  const target = await offer("unknown");
  const created = await begin(target);
  await db.query("select public.assert_offer_availability_execution($1)", [
    created.operation.id,
  ]);
  await expect(
    finish(created.operation.id, "failed", "Active", "NETWORK_ERROR"),
  ).rejects.toThrow(/definitive rejection/i);
  expect(
    (await finish(created.operation.id, "unknown", "Active", "NETWORK_ERROR"))
      .status,
  ).toBe("unknown");
  await expect(
    finish(created.operation.id, "failed", "Active", "NOT_OBSERVED"),
  ).rejects.toThrow(/must remain blocked/i);
  await expect(
    finish(created.operation.id, "rejected", "Active", "NOT_OBSERVED"),
  ).rejects.toThrow(/must remain blocked/i);
  await expect(
    finish(created.operation.id, "succeeded", "Active"),
  ).rejects.toThrow(/has not been verified/i);
  await identity();
  await expect(begin(target)).rejects.toThrow(/needs reconciliation/i);
  const completed = await finish(
    created.operation.id,
    "succeeded",
    "Paused",
    null,
    {
      id: target,
      native_id: "unknown",
      source: "items",
      title: "Synthetic listing",
      category: "Item",
      state: "Paused",
      price: null,
      currency: null,
      quantity: null,
      game_id: null,
      updated_at: "2026-11-02T12:01:00.000Z",
    },
  );
  expect(completed.status).toBe("succeeded");
  const result = await db.query<{ state: string }>(
    "select state from public.offers where id=$1",
    [target],
  );
  expect(result.rows[0].state).toBe("Paused");
  await identity();
  const resumed = await begin(
    target,
    key(),
    "resume",
    "2026-11-02T12:01:00.000Z",
  );
  expect(resumed.operation.status).toBe("running");
});

it("isolates staff journal access and rejects attempts to update a different snapshot", async () => {
  const target = await offer("isolation");
  const created = await begin(target);
  await identity(viewer, viewerSession);
  const hidden = await db.query(
    "select id from public.offer_availability_operations where id=$1",
    [created.operation.id],
  );
  expect(hidden.rows).toHaveLength(0);
  await expect(
    finish(created.operation.id, "succeeded", "Paused", null, {
      id: "items:other",
      native_id: "isolation",
      source: "items",
      state: "Paused",
      title: "Synthetic listing",
      category: "Item",
      updated_at: snapshot,
    }),
  ).rejects.toThrow(/does not match/i);
  await identity();
  const own = await db.query(
    "select id from public.offer_availability_operations where id=$1",
    [created.operation.id],
  );
  expect(own.rows).toHaveLength(1);
});

it("blocks a second source alias for the same upstream listing until the first outcome is confirmed", async () => {
  const target = await offer("shared-native");
  const alias = "currency:shared-native";
  await db.exec("reset role");
  await db.query(
    `insert into public.offers(id,native_id,source,category,title,state,updated_at)
     values($1,'shared-native','currency','Currency','Synthetic alias','Active',$2)`,
    [alias, snapshot],
  );
  await db.query(
    "update public.offers set price=case when id=$1 then 9 else 33 end,currency='USD' where native_id='shared-native'",
    [target],
  );
  await identity();
  const first = await begin(target);
  await expect(begin(alias)).rejects.toThrow(/needs reconciliation/i);
  await db.query("select public.assert_offer_availability_execution($1)", [
    first.operation.id,
  ]);
  await finish(first.operation.id, "unknown", "Active", "NETWORK_ERROR");
  await identity();
  await expect(begin(alias)).rejects.toThrow(/needs reconciliation/i);
  await finish(first.operation.id, "succeeded", "Paused");
  const pausedAliases = await db.query<{
    id: string;
    state: string;
    title: string;
    price: number;
    refreshed: boolean;
  }>(
    `select id,state,title,price::float8 as price,updated_at<>$1::timestamptz as refreshed
     from public.offers where native_id='shared-native' order by id`,
    [snapshot],
  );
  expect(pausedAliases.rows).toEqual([
    {
      id: alias,
      state: "Paused",
      title: "Synthetic alias",
      price: 33,
      refreshed: true,
    },
    {
      id: target,
      state: "Paused",
      title: "Synthetic listing",
      price: 9,
      refreshed: true,
    },
  ]);
  await db.query(
    "update public.offers set state='Paused',updated_at=$1 where id=$2",
    ["2026-11-02T12:01:00.000Z", alias],
  );
  await identity();
  const next = await begin(alias, key(), "resume", "2026-11-02T12:01:00.000Z");
  expect(next.reused).toBe(false);
  expect(next.operation.status).toBe("running");
  await finish(next.operation.id, "succeeded", "Active", null, {
    id: alias,
    native_id: "shared-native",
    source: "currency",
    title: "Fresh alias metadata",
    category: "Currency",
    state: "Active",
    price: 55,
    currency: "USD",
    quantity: 4,
    game_id: "synthetic-game",
    updated_at: "2026-11-02T12:02:00.000Z",
  });
  const activeAliases = await db.query<{
    id: string;
    state: string;
    title: string;
    price: number;
  }>(
    "select id,state,title,price::float8 as price from public.offers where native_id='shared-native' order by id",
  );
  expect(activeAliases.rows).toEqual([
    { id: alias, state: "Active", title: "Fresh alias metadata", price: 55 },
    { id: target, state: "Active", title: "Synthetic listing", price: 9 },
  ]);
});

it("enforces the same justification bounds for direct RPC callers", async () => {
  const target = await offer("reason-bounds");
  for (const reason of ["too short", "x".repeat(1001)]) {
    await expect(
      db.query("select public.begin_offer_availability($1,'pause',$2,$3,$4)", [
        target,
        snapshot,
        key(),
        reason,
      ]),
    ).rejects.toThrow(/invalid availability request/i);
  }
});

it("limits new operations while allowing an identical completed retry", async () => {
  const firstTarget = await offer("rate-0");
  const firstKey = key();
  await identity(admin, adminSession);
  const first = await begin(firstTarget, firstKey);
  await finish(first.operation.id, "rejected", "Active", "PRECHECK_CHANGED");
  for (let index = 1; index < 10; index++) {
    const target = await offer("rate-" + index);
    await identity(admin, adminSession);
    const operation = await begin(target);
    await finish(
      operation.operation.id,
      "rejected",
      "Active",
      "PRECHECK_CHANGED",
    );
  }
  const limitedTarget = await offer("rate-limited");
  await identity(admin, adminSession);
  await expect(begin(limitedTarget)).rejects.toThrow(/rate limit reached/i);
  const retry = await begin(firstTarget, firstKey);
  expect(retry.reused).toBe(true);
  expect(retry.operation.id).toBe(first.operation.id);
});

it("revoked sessions cannot begin or claim availability operations", async () => {
  const target = await offer("revoked");
  const created = await begin(target);
  await db.exec("reset role");
  await db.query(
    "update public.employee_sessions set revoked_at=now() where id=$1",
    [ownerSession],
  );
  await identity();
  await expect(begin(target)).rejects.toThrow(/permission required/i);
  await expect(
    db.query("select public.assert_offer_availability_execution($1)", [
      created.operation.id,
    ]),
  ).rejects.toThrow(/permission required/i);
});
