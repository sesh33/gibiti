"""Configure the app's private hosted scheduler without printing/storing secrets.

Administration tokens are supplied by the operator environment, never Vercel.
The shared worker key is generated/reused in memory and encrypted by Vault and
Vercel. No Seller mutation or enabled automation is used as a deployment test.
"""
import argparse
import json
import os
import pathlib
import secrets
import urllib.error
import urllib.parse
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--project', required=True)
parser.add_argument('--team', required=True)
parser.add_argument('--supabase-ref', required=True)
parser.add_argument('--origin', required=True)
parser.add_argument('--check-production', action='store_true')
args = parser.parse_args()
origin = urllib.parse.urlsplit(args.origin)
if origin.scheme != 'https' or origin.username or origin.password or origin.path or origin.query or origin.fragment:
    raise SystemExit('Use the exact canonical HTTPS origin without a trailing slash.')

def sql_literal(value):
    return "'" + value.replace("'", "''") + "'"

def api(url, token, body=None, method=None):
    request = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None,
        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}, method=method)
    with urllib.request.urlopen(request, timeout=60) as response:
        raw = response.read()
        return json.loads(raw) if raw else None

def query(sql):
    return api('https://api.supabase.com/v1/projects/' + args.supabase_ref + '/database/query',
        os.environ['SUPABASE_ACCESS_TOKEN'], {'query': sql})

try:
    # Vault is already supplied by managed Supabase. Check before creating any
    # new secret; never rotate a configured key on an ordinary deployment.
    existing = query("select id,decrypted_secret from vault.decrypted_secrets where name='rivox_worker_bearer';")
    worker_key = existing[0]['decrypted_secret'] if existing else secrets.token_urlsafe(32)
    if not existing:
        query('select vault.create_secret(' + sql_literal(worker_key) + ", 'rivox_worker_bearer', 'RIVOX hosted worker authentication');")
    api('https://api.vercel.com/v10/projects/' + args.project + '/env?teamId=' + args.team + '&upsert=true',
        os.environ['VERCEL_TOKEN'], [{'key': 'CRON_SECRET', 'value': worker_key, 'type': 'encrypted', 'target': ['production']}], 'POST')
    source = pathlib.Path(__file__).resolve().parent.parent / 'supabase/automation-scheduler.sql'
    query(source.read_text())
    facts = query("select (select count(*) from cron.job where jobname='rivox-hosted-worker' and active) as active_jobs,(select schedule from cron.job where jobname='rivox-hosted-worker') as schedule,has_function_privilege('authenticated','public.dispatch_rivox_worker()','EXECUTE') as staff_dispatch,has_function_privilege('anon','public.dispatch_rivox_worker()','EXECUTE') as anon_dispatch,has_table_privilege('authenticated','vault.decrypted_secrets','SELECT') as staff_vault_read;")[0]
    if facts['active_jobs'] != 1 or facts['schedule'] != '15 seconds' or facts['staff_dispatch'] or facts['anon_dispatch'] or facts['staff_vault_read']:
        raise RuntimeError('Scheduler permission verification failed')
    query('update public.automation_runtime set worker_origin=' + sql_literal(args.origin) + ',scheduler_configured=true where id;')
    result = {'schedulerConfigured': True, 'cronJobs': facts['active_jobs'], 'schedule': facts['schedule'], 'secretInOutput': False, 'automationEnabledBySetup': False}
    if args.check_production:
        response = api(args.origin + '/api/automation/worker', worker_key, {'mode': 'diagnostic'}, 'POST')
        if response.get('mode') != 'diagnostic' or response.get('upstreamWrites') != 0 or response.get('origin') != args.origin:
            raise RuntimeError('Hosted diagnostic did not match this project')
        result['productionDiagnostic'] = response
        # Also prove that the scheduler's database HTTP transport reaches the
        # published route. The query contains only a Vault lookup, never its key.
        transport = query("select status from extensions.http(('POST'," + sql_literal(args.origin + '/api/automation/worker') + ",array[extensions.http_header('Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='rivox_worker_bearer'))],'application/json','{\"mode\":\"diagnostic\"}')::extensions.http_request);")
        if not transport or transport[0]['status'] != 200:
            raise RuntimeError('The scheduler transport could not reach its diagnostic endpoint')
        result['databaseHttpDiagnostic'] = transport[0]['status']
    print(json.dumps(result))
except urllib.error.HTTPError as error:
    # Provider error text may contain the SQL/request body. Never print it.
    print(json.dumps({'automationSetup': 'failed', 'http': error.code}))
    raise SystemExit(1)
except Exception as error:
    print(json.dumps({'automationSetup': 'failed', 'errorType': type(error).__name__}))
    raise SystemExit(1)
