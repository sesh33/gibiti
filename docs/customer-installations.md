# Dedicated customer installations

The commercial model is one independently hosted site per customer. Each site
has its own Supabase project, Vercel project/domain, Owner/team, Seller API
credentials, persistent encryption key, inventory, automation rules and audit.
The application remains in English. No shared database or silent reseller access
to customer credentials is provided.

Public branding variables are `NEXT_PUBLIC_WORKSPACE_NAME`,
`NEXT_PUBLIC_WORKSPACE_ORGANIZATION` and `NEXT_PUBLIC_WORKSPACE_ACCENT`
(`blue`, `violet`, `emerald` or `amber`). Rebuild after changing them.

Prepare a clean source kit without reading environment secrets or copying data:

```sh
python scripts/package-client.py --name "CUSTOMER" --output /workspace/artifacts/customer-installation.zip
```

The ZIP contains runtime source/configuration, numbered migrations, an empty
environment template, a guarded transactional first-install SQL bundle with
migration history, and `INSTALL-CUSTOMER.md`. It excludes `.rivox`, real env files,
Git history, browser captures, database data, delivery secrets, generated build
files and operational artifacts. Packaging neither creates resources nor pays
for hosting. The customer Owner verifies their own email and enrolls MFA.

Use a new empty Supabase database and separate Vercel project for each sale.
Never clone an occupied production database or reuse Rivox keys. The included
guide covers exact HTTPS origin/redirects, SMTP, Owner activation, the private
hosted scheduler and a read-only acceptance check. Keep database/encryption-key
backups under the customer's control. The persistent encryption key must survive
ordinary redeployment; the worker key is also unique per installation.

Current supported workflows include reviewed predefined offers, selected-target
batches, four catalog read adapters and pause/resume, eligible order actions,
precision repricing, notification/account tools, official reporting, individual
staff accounts, scoped permissions, encrypted internal inventory and copy-only
reply templates. Unspecified catalog-family edit DTOs, broad bulk imports,
destructive deletion and general chat are not claimed as supported.
