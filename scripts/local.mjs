import { randomBytes } from "node:crypto";
// Local Supabase + real application. Does not provision or migrate any hosted project.
import { spawn, execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  mkdirSync,
  openSync,
  writeFileSync,
  closeSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const state = join(root, ".rivox");
mkdirSync(state, { recursive: true, mode: 0o700 });
const cliModule = join(state, "tools/node_modules/supabase/dist/supabase.js");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
if (existsSync(join(root, ".env.local")))
  process.loadEnvFile(join(root, ".env.local"));
const logPath = join(state, "local-start.log");
function run(command, args, env = process.env) {
  return new Promise((resolveRun, reject) => {
    const log = openSync(logPath, "a", 0o600);
    const child = spawn(command, args, {
      cwd: root,
      env,
      stdio: ["ignore", log, log],
      shell: process.platform === "win32" && command.endsWith(".cmd"),
    });
    child.on("error", () => {
      closeSync(log);
      reject(
        new Error(
          "A local setup command could not start. Check Docker Desktop and the private .rivox/local-start.log.",
        ),
      );
    });
    child.on("exit", (code) => {
      closeSync(log);
      if (code === 0) resolveRun();
      else
        reject(
          new Error(
            "Local setup failed. Inspect .rivox/local-start.log privately; it can contain local credentials.",
          ),
        );
    });
  });
}
try {
  if (!existsSync(join(root, "node_modules/next/dist/bin/next")))
    throw new Error("Run npm ci before npm run local.");
  execFileSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
    stdio: "pipe",
  });
  if (!existsSync(cliModule)) {
    console.log("Installing the pinned official Supabase CLI...");
    await run(npmCommand, [
      "install",
      "--prefix",
      join(state, "tools"),
      "--save-exact",
      "supabase@2.122.0",
      "--cache",
      join(state, "npm-cache"),
    ]);
  }
  const dockerConfig = join(state, "docker-config");
  mkdirSync(dockerConfig, { recursive: true, mode: 0o700 });
  const dockerConfigFile = join(dockerConfig, "config.json");
  if (!existsSync(dockerConfigFile))
    writeFileSync(
      dockerConfigFile,
      JSON.stringify({ proxies: { default: {} } }),
      { mode: 0o600 },
    );
  const localEnv = {
    ...process.env,
    ...(process.env.HTTP_PROXY || process.env.HTTPS_PROXY
      ? { DOCKER_CONFIG: dockerConfig }
      : {}),
    SUPABASE_HOME: join(state, "cli-home"),
    SUPABASE_TELEMETRY_DISABLED: "true",
    SUPABASE_USE_SLIM_IMAGES: "true",
    SUPABASE_INTERNAL_IMAGE_REGISTRY: "ghcr.io",
  };
  for (const key of [
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_DB_PASSWORD",
    "SUPABASE_ACCESS_TOKEN",
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SECRET_KEY",
    "SUPABASE_ANON_KEY",
  ])
    delete localEnv[key];
  console.log(
    "Starting isolated local Supabase services (first download can take several minutes)...",
  );
  await run(
    process.execPath,
    [
      cliModule,
      "start",
      "--exclude",
      "realtime,storage-api,imgproxy,studio,postgres-meta,edge-runtime,logflare,vector,supavisor",
    ],
    localEnv,
  );
  console.log("Applying pending migrations to the local database only...");
  await run(
    process.execPath,
    [cliModule, "migration", "up", "--local"],
    localEnv,
  );
  const raw = execFileSync(
    process.execPath,
    [cliModule, "status", "--output", "env"],
    {
      cwd: root,
      env: localEnv,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    },
  );
  const values = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)="(.*)"$/);
    if (m) values[m[1]] = m[2];
  }
  const apiUrl = values.API_URL ?? values.SUPABASE_URL;
  const publicKey = values.PUBLISHABLE_KEY ?? values.ANON_KEY;
  const serviceKey = values.SECRET_KEY ?? values.SERVICE_ROLE_KEY;
  if (
    !apiUrl ||
    !publicKey ||
    !serviceKey ||
    !["127.0.0.1", "localhost"].includes(new URL(apiUrl).hostname)
  )
    throw new Error(
      "The CLI did not return valid local-only service bindings.",
    );
  const port = String(process.env.RIVOX_LOCAL_PORT || 3000);
  if (!/^\d{4,5}$/.test(port) || Number(port) > 65535)
    throw new Error("Choose a valid RIVOX_LOCAL_PORT.");
  const keyPath = join(state, "inventory.key");
  if (!process.env.INVENTORY_ENCRYPTION_KEY && !existsSync(keyPath))
    writeFileSync(keyPath, randomBytes(32).toString("hex"), {
      mode: 0o600,
      flag: "wx",
    });
  const inventoryKey =
    process.env.INVENTORY_ENCRYPTION_KEY ||
    readFileSync(keyPath, "utf8").trim();
  const env = {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: apiUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publicKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceKey,
    APP_ORIGIN: `http://127.0.0.1:${port}`,
    RIVOX_SETUP_PORT: port,
    RIVOX_DEV_MOCKS: "false",
    INVENTORY_ENCRYPTION_KEY: inventoryKey,
  };
  // Only local generated bindings are cached. Hosted seller/API secrets are never copied here.
  writeFileSync(
    join(state, "local-bindings.json"),
    JSON.stringify({
      NEXT_PUBLIC_SUPABASE_URL: apiUrl,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publicKey,
      SUPABASE_SERVICE_ROLE_KEY: serviceKey,
      APP_ORIGIN: env.APP_ORIGIN,
    }),
    { mode: 0o600 },
  );
  console.log(
    "Local database and Auth are running. Launching the private Owner setup...",
  );
  const child = spawn(
    process.execPath,
    [resolve(root, "scripts/start-owner-setup.mjs")],
    { cwd: root, env, stdio: "inherit" },
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => child.kill(signal));
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : "Local setup failed.");
  process.exitCode = 1;
}
