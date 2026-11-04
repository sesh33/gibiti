# RIVOX Control

Private catalog and seller operations with individual employee accounts, Next.js, Supabase Auth/PostgreSQL/RLS and audited permissions.

## Main workflow

Authorized employees synchronize listings, inspect state/price/quantity and explicitly pause or resume one eligible listing. Changes require a reason, current permissions, a durable idempotency key and upstream state verification. Uncertain outcomes block resubmission. Staff never receive Eldorado login credentials or API secrets.

The Catalog operator preset grants listing reads, pause/resume and assigned-order context. Saving a profile does not assign it: access changes still require an independent reviewer.

**Price, quantity, details, creation, deletion and order-delivery execution are not implemented.** The official request bodies must be supplied before these actions can be enabled. Messaging is excluded from the official Seller API.

## Hosting and access

The authorized Vercel project is live at [rivox-control.vercel.app](https://rivox-control.vercel.app). HTTPS/access-control smoke checks passed; the intended Owner must still claim their own verified access. Hosted Supabase has 12 application migrations, RLS, explicit private RPC grants and migration history.

Private first-Owner setup requires an expiring capability, verified email, the user's own password and MFA. No default credentials exist. Owner setup supports the standard Supabase confirmation email link; employee invitations can use private links without SMTP.

The active Eldorado proxy secret currently permits only Eldorado destinations. Secure transfer to Vercel requires adding `api.vercel.com` to that existing binding in environment settings. No duplicate secret or placeholder is deployed as a workaround.

## Verified behavior

- Official live reads passed for orders, all four listing adapters and individual states for flexible/predefined/currency. Currency search uses its verified GET JSON-body contract.
- Observed catalog: one Account/Active and one Currency/Closed listing. Currency appears in two adapters; source records are not unique listing totals. Closed is never treated as Paused.
- Eight observed orders were Received: delivery confirmed, distinct from Completed and released funds. Unknown future states stay separate from pending and financial totals.
- Individual access, order assignment/notes, reviewed role changes, session revocation and audited internal inventory operations are implemented.
- No real commercial mutation was used as a setup test. Controlled write tests do not establish live-write validation.

## Development

For isolated development, Node.js 22.19+ and Docker Engine are required. Employees using the hosted site do not need local tools.

```sh
npm ci
npm run local
```

See [local development](docs/localhost.md). Production builds use the supported Webpack compiler because the Turbopack worker port is blocked in the cloud sandbox; type/security checks remain enabled.

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
node scripts/check-offer-availability-ui.mjs
```

Live reads are opt-in: `RIVOX_LIVE_READS=true npm run test:live-reads`.

[Implementation evidence](docs/implementation-status.md) · [Deployment](docs/deployment.md) · [Offer contracts](docs/eldorado-offer-contracts.md) · [Messaging evidence](docs/messaging-investigation.md)
