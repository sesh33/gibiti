// Produce a reviewable first-install bundle. Never executes SQL or resets data.
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url)),
  target = join(root, ".rivox");
mkdirSync(target, { recursive: true, mode: 0o700 });
const files = readdirSync(join(root, "supabase/migrations"))
  .filter((file) => file.endsWith(".sql"))
  .sort();
const guard = `-- RIVOX Control first installation only. Review before execution in your intended Supabase SQL Editor.\n-- This script never deletes or resets schemas/data and refuses an occupied public schema.\nbegin;\ndo $$begin if exists(select 1 from pg_tables where schemaname='public') then raise exception 'Public schema is not empty. Inspect existing migrations before proceeding.';end if;end$$;\n`;
const bundle =
  guard +
  files
    .map(
      (file) =>
        "\n-- " +
        file +
        "\n" +
        readFileSync(join(root, "supabase/migrations", file), "utf8"),
    )
    .join("\n") +
  "\ncommit;\n";
writeFileSync(join(target, "hosted-first-install.sql"), bundle, {
  mode: 0o600,
});
console.log(
  "Prepared .rivox/hosted-first-install.sql (" +
    files.length +
    " migrations). Nothing was executed against a hosted database.",
);
