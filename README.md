# RIVOX Control

Private catalog and seller operations with individual employee accounts, Next.js, Supabase Auth/PostgreSQL/RLS and audited permissions.

## Main workflow

Authorized employees synchronize listings, inspect state/price/quantity and explicitly pause or resume one eligible listing. Changes require a reason, current permissions, a durable idempotency key and upstream state verification. Uncertain outcomes block resubmission. Staff never receive Eldorado login credentials or API secrets.

The Catalog operator preset grants listing reads, pause/resume and assigned-order context. Saving a profile does not assign it: access changes still require an independent reviewer. Full details replacement requires create, price and stock permissions together. Predefined API pages and sold-order cursors are supported. New-order polling is opt-in, read-only, configurable and backs off on errors/429.

Predefined listing creation, details replacement, individual price/quantity changes and eligible order delivery/cancellation/deadline extension use the user-supplied official Swagger contracts. A staff request is independently approved, then an authorized participant confirms execution with MFA. Order delivery means marking an already completed transfer as delivered; it does not transfer in-game goods. Deletion, bulk operations, automatic repricing and chat sending are not enabled. Messaging is excluded from the official Seller API.

## Hosting and access

The authorized Vercel project is live at [rivox-control.vercel.app](https://rivox-control.vercel.app). HTTPS/access-control smoke checks passed; the intended Owner must still claim their own verified access. Hosted Supabase has 14 application migrations, RLS, explicit private RPC grants and migration history.

Private first-Owner setup requires an expiring capability, verified email, the user's own password and MFA. No default credentials exist. Owner setup supports the standard Supabase confirmation email link; employee invitations can use private links without SMTP.

After MFA, the Owner connects Eldorado in Settings using the existing Seller API client secret. The server verifies an official order read, stores the secret encrypted and audits the change. Employees cannot retrieve or configure it. An environment secret remains an alternative for direct server deployments; cloud proxy placeholders must never be copied into Vercel.

The reply library provides English/French team messages for Donut SMP, Robux and general support. Required order details must be filled before copying. It does not send messages. The Owner can also check official notification, pending-review and restriction counts without changing their marketplace state.

This is currently a private workspace for one seller account. Organization isolation, subscription billing and onboarding independent seller tenants are not implemented; it must not be sold as a multi-tenant SaaS yet.

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
node scripts/check-connection-ui.mjs
node scripts/check-marketplace-ui.mjs
```

Live reads are opt-in: `RIVOX_LIVE_READS=true npm run test:live-reads`.

[Implementation evidence](docs/implementation-status.md) · [Deployment](docs/deployment.md) · [Offer contract evidence](docs/eldorado-offer-contracts.md) · [Supplied Seller contracts](docs/eldorado-seller-contracts.md) · [Messaging evidence](docs/messaging-investigation.md)
