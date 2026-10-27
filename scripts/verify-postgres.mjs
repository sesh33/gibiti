// Optional integration test against a disposable, network-isolated PostgreSQL 17 container.
// No hosted database or real credentials are used. Start the container as documented.
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
const container = process.env.RIVOX_TEST_CONTAINER || "rivox-postgres-check";
const inspection = JSON.parse(
  execFileSync("docker", ["inspect", container], { encoding: "utf8" }),
)[0];
assert.equal(
  inspection.Config.Labels?.["io.rivox.disposable-test"],
  "true",
  "Refusing to reset a container without the RIVOX disposable-test label.",
);
assert.equal(
  inspection.HostConfig.NetworkMode,
  "none",
  "Test container must be network-isolated.",
);
assert.equal(
  Object.keys(inspection.HostConfig.PortBindings ?? {}).length,
  0,
  "Test container must have no published ports.",
);
function sql(input) {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
    ],
    { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
}
function asyncSql(input) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
    ]);
    let out = "",
      err = "";
    child.stdout.on("data", (data) => (out += data));
    child.stderr.on("data", (data) => (err += data));
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve(out) : reject(new Error(err)),
    );
    child.stdin.end(input);
  });
}
// Running twice replaces only the synthetic public/auth schemas in this dedicated disposable container.
sql(
  `drop schema public cascade;drop schema if exists auth cascade;create schema public;create schema auth;do $$begin if not exists(select from pg_roles where rolname='anon') then create role anon;end if;if not exists(select from pg_roles where rolname='authenticated') then create role authenticated;end if;if not exists(select from pg_roles where rolname='service_role') then create role service_role bypassrls;end if;end$$;grant usage on schema public to authenticated,service_role;create table auth.users(id uuid primary key);create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;grant usage on schema auth to authenticated;grant execute on all functions in schema auth to authenticated;`,
);
for (const migration of readdirSync("supabase/migrations")
  .filter((file) => file.endsWith(".sql"))
  .sort())
  sql(readFileSync(`supabase/migrations/${migration}`, "utf8"));
const owner = "11111111-1111-4111-8111-111111111111",
  agent = "22222222-2222-4222-8222-222222222222",
  order = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  item = "66666666-6666-4666-8666-666666666666";
sql(
  `insert into auth.users values('${owner}'),('${agent}');insert into public.users values('${owner}','owner@example.test','Synthetic Owner','OWNER',true,now()),('${agent}','agent@example.test','Synthetic Agent','SUPPORT_AGENT',true,now());insert into public.orders(id,buyer_username,quantity,amount,currency,state,product_title,purchased_at) values('${order}','Synthetic buyer',1,10,'USD','Paid','Fixture',now()),('${other}','Other fixture',1,10,'USD','Paid','Fixture',now());insert into public.order_assignments values('${order}','${agent}','${owner}',now());insert into public.inventory_items(id,sku,title,category) values('${item}','FIXTURE','Synthetic product','Roblox');`,
);
function session(user, aal = "aal1") {
  return `set role authenticated;select set_config('request.jwt.claims','${JSON.stringify({ sub: user, aal, session_id: user })}',false);select public.register_employee_session();`;
}
assert.equal(
  sql(session(agent) + "select count(*) from public.orders;")
    .split("\n")
    .at(-1),
  "1",
);
assert.equal(
  sql(session(owner) + "select count(*) from public.orders;")
    .split("\n")
    .at(-1),
  "0",
);
assert.equal(
  sql(session(owner, "aal2") + "select count(*) from public.orders;")
    .split("\n")
    .at(-1),
  "2",
);
assert.throws(() =>
  sql(
    session(agent) +
      `update public.users set role='OWNER' where id='${agent}';`,
  ),
);
// Two separate PostgreSQL sessions contend for the same item. Exactly one reservation succeeds.
const first = asyncSql(
  session(owner, "aal2") +
    `begin;select public.reserve_inventory('${item}','${order}');select pg_sleep(0.2);commit;`,
);
const second = asyncSql(
  session(owner, "aal2") +
    `begin;select public.reserve_inventory('${item}','${other}');commit;`,
);
const outcomes = await Promise.allSettled([first, second]);
assert.equal(
  outcomes.filter((result) => result.status === "fulfilled").length,
  1,
);
assert.equal(
  outcomes.filter((result) => result.status === "rejected").length,
  1,
);
assert.equal(
  sql(
    `select count(*) from public.inventory_reservations where item_id='${item}' and released_at is null;`,
  ),
  "1",
);
assert.equal(
  sql(
    "select count(*) from public.audit_logs where action='inventory.reserved';",
  ),
  "1",
);
console.log(
  "PostgreSQL 17: migrations, assignment RLS, MFA boundary, direct-write denial, and two-session reservation contention passed.",
);
