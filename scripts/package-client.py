"""Build a clean, data-free source kit for one independently hosted customer.

This command performs no network requests, creates no paid resources and never
reads/copies operator environment values or local data. Each customer supplies
their own Supabase/Vercel projects, encryption keys and Seller credentials.
"""
import argparse
import json
import pathlib
import subprocess
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('--name', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args()
if not 1 <= len(args.name.strip()) <= 32 or any(c in args.name for c in '\r\n\x00'):
    raise SystemExit('Choose a client display name of 1–32 characters.')
root = pathlib.Path(__file__).resolve().parent.parent
target = pathlib.Path(args.output).resolve()
target.parent.mkdir(parents=True, exist_ok=True)
if target.suffix != '.zip':
    raise SystemExit('Output must end in .zip.')
paths = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd=root).decode().split('\0')
allowed_roots = ('src/', 'public/', 'supabase/migrations/')
allowed_files = {'package.json', 'package-lock.json', 'next.config.ts', 'tsconfig.json', 'postcss.config.mjs', 'eslint.config.mjs', '.gitignore', '.env.example', 'vercel.json', 'AGENTS.md', 'supabase/automation-scheduler.sql', 'scripts/configure-hosted-automation.py', 'scripts/database-bundle.mjs'}
instructions = '''# Dedicated customer installation

This is a separate installation for one seller. Keep the interface in English.

1. Create a new private Supabase project and a separate Vercel project for this
   customer. Never point this site at Rivox's database or another customer's.
2. Apply all numbered migrations to the empty database in order. The included
   first-install bundle refuses an occupied schema and records migration history.
3. Configure the names in .env.example using secure Vercel settings. Obtain this
   project's own Supabase keys. Generate a fresh INVENTORY_ENCRYPTION_KEY (32 bytes
   as 64 hex characters); preserve it across redeployments and in secure backups.
4. Set APP_ORIGIN and Supabase Auth Site URL/redirects to this customer's exact
   HTTPS origin. Disable public signup. Configure SMTP for customer email delivery.
5. Set the customer's own ELDORADO_CLIENT_ID. Their Owner connects its matching
   Client Secret in Settings; never copy Rivox credentials or delivery inventory.
6. Configure NEXT_PUBLIC_WORKSPACE_NAME/ORGANIZATION/ACCENT for branding and build
   with npm ci && npm run build. Deploy using the Next.js Vercel preset.
7. Configure private first-Owner activation: RIVOX_HOSTED_OWNER_SETUP=true,
   RIVOX_BOOTSTRAP_ENABLED=true, an app-generated private RIVOX_BOOTSTRAP_TOKEN
   (43–128 URL-safe characters), and RIVOX_BOOTSTRAP_EXPIRES_AT (epoch milliseconds,
   at most one hour ahead). Deliver the private /setup/owner#setup=... handoff only
   to the intended customer Owner. Never include the capability in logs or URLs
   sent to monitoring systems. The Owner verifies email and enrolls MFA.
8. Configure the hosted scheduler using configure-hosted-automation.py with this
   customer's own project/team/ref/origin. Management tokens remain operator-only.
   It creates a separate private Vault/Vercel key. Do not copy CRON_SECRET from
   another installation. Confirm its diagnostic after deployment.
9. Verify sign-in, MFA, staff isolation and actual read-only Seller queries on
   the published domain. No commercial mutation is a setup test. All automation
   starts OFF. The Owner defines floors and reviews explicit automatic authority.

Each installed Owner controls their own operation. A reseller does not silently
receive access to customer accounts, API secrets or in-game delivery credentials.
Chat sending is not provided by the Seller API; reply templates are for copying.
Release source is not proof of business validation or live-write acceptance.
'''
versions = sorted((root / 'supabase/migrations').glob('*.sql'))
sql = "begin;\ndo $$begin if exists(select 1 from pg_tables where schemaname='public') then raise exception 'Use a new empty customer database';end if;end $$;\ncreate schema if not exists supabase_migrations;\ncreate table if not exists supabase_migrations.schema_migrations(version text primary key,statements text[],name text);\n"
for migration in versions:
    body = migration.read_text()
    delimiter = '$client_migration_source$'
    if delimiter in body:
        raise SystemExit('Unexpected migration delimiter.')
    version, name = migration.stem.split('_', 1)
    sql += '\n' + body + "\ninsert into supabase_migrations.schema_migrations(version,name,statements) values('" + version + "','" + name + "',array[" + delimiter + body + delimiter + "]);\n"
sql += 'commit;\n'
with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name in sorted(set(filter(None, paths))):
        if not (name in allowed_files or name.startswith(allowed_roots)):
            continue
        if name.startswith('.env') and name != '.env.example':
            raise SystemExit('Private environment file cannot be packaged.')
        path = root / name
        if not path.is_file() or path.is_symlink():
            continue
        if name == 'package.json':
            package = json.loads(path.read_text())
            package['scripts'] = {key: value for key, value in package['scripts'].items() if key in {'dev', 'build', 'start', 'lint', 'typecheck', 'db:bundle'}}
            archive.writestr(name, json.dumps(package, indent=2))
        elif name == '.env.example':
            archive.writestr(name, path.read_text().replace('NEXT_PUBLIC_WORKSPACE_NAME=\n', 'NEXT_PUBLIC_WORKSPACE_NAME=' + json.dumps(args.name.strip()) + '\n'))
        else:
            archive.writestr(name, path.read_bytes())
    archive.writestr('INSTALL-CUSTOMER.md', instructions)
    archive.writestr('first-install.sql', sql)
    archive.writestr('instance.example.json', json.dumps({'brand': args.name.strip(), 'language': 'en', 'separateDatabaseRequired': True, 'copyExistingSellerCredentials': False, 'automaticModesEnabled': False}, indent=2))
target.chmod(0o600)
print(json.dumps({'package': str(target), 'migrations': len(versions), 'dataIncluded': False, 'secretsIncluded': False, 'networkRequests': 0}))
