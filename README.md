# RIVOX Control

Private seller operations and customer support workspace for an Eldorado.gg team. Built with Next.js App Router, strict TypeScript, Tailwind CSS, shadcn-style Radix components, Supabase Auth/PostgreSQL/RLS, TanStack Query, and Zod.

**Status: implemented foundation, not a production-certified or fully integrated product.** The earlier vanilla demo has been replaced. There are no invented sales, buyers, or conversations in the default workspace.

## Run locally

Requires Node.js 22 or later.

```sh
npm ci
npm run dev
```

The app listens on the loopback interface, port 3000. With no credentials, it renders an honest setup workspace; all data APIs fail closed. Configure values through secure environment settings or an ignored local `.env.local`, using `.env.example` as a list of names. Rebuild/restart after environment changes, especially `NEXT_PUBLIC_*` bindings.

```sh
npm run typecheck
npm test
npm run build
npm start
```

## Implemented

- RIVOX interface in American English: Smart Inbox, Order Center/details, overview, offers, inventory, team, approvals, activity, settings, sign-in, invitation setup, and MFA screens.
- Supabase email/password and invitation confirmation flows; individual staff membership; mandatory TOTP assurance for Owner/Admin; revocable employee sessions; refresh proxy.
- A six-role permission catalog, individual overrides, backend authorization and PostgreSQL RLS. Staff cannot directly mutate roles, audit records, orders, or assignments through the public database API.
- Owner-confirmed invitations. Permission/deactivation changes require a distinct authorized MFA reviewer; requester/recipient self-approval is prohibited. Approved changes and session revocation commit together.
- Read-only Eldorado client with validated token/order contracts, concurrent refresh protection, early renewal, bounded timeouts, a single retry after 401, and no credential exposure to the browser.
- Transactional order-page/history persistence, cursor pagination of local records, filters, search, sorting, polling, explicit partial-history metrics, and scoped order details.
- Audited assignments, internal notes, inventory metadata and atomic reservations. Optional inventory secret ingestion encrypts with AES-256-GCM into a separate, non-public table. Protected, audited secret access and reservation release are implemented. Inventory consumption requires a separate reviewer and never updates an Eldorado order. Key rotation remains a release prerequisite.
- Audited approval requests and decisions with idempotency/uniqueness enforcement. **Approving an external action does not execute it.**
- Abstract `MessagingProvider`, unavailable provider, and explicitly opt-in development-only mock. Production cannot enable the mock. Quick-reply templates do not invoke an AI model.

## External prerequisites

See [Deployment](docs/deployment.md) for secure setup, migration/Owner bootstrap, invitation email configuration, and MFA. The supplied project URL is `https://dsfnqlwhexcjqanwnklz.supabase.co`; no project keys are included in this repository.

Required binding names:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — server only
- `APP_ORIGIN` — exact application origin, such as your HTTPS deployment origin
- `ELDORADO_CLIENT_ID`
- `ELDORADO_CLIENT_SECRET` — server only

Do not paste secrets into chat. Revoke previously exposed client secrets and configure a fresh pair securely.

The documented order response has cursor fields, but the request parameter contract has not been independently verified. The first upstream page may be requested once credentials are configured. Further upstream pagination requires checking the official contract and setting the non-secret `ELDORADO_CURSOR_PARAMETER`; no parameter name is assumed by default.

## Explicit boundaries

Live Supabase authentication/invitations and hosted migrations have **not** been exercised against the supplied project because keys are missing and the current network proxy denied access. Live Eldorado reads have **not** been exercised. Delivery/cancellation/offer writes remain unavailable until official payloads and allowed transitions are verified and a single real write is explicitly authorized. No real write was attempted.

Official messaging is unresolved. The `talkJsConversationId` field does not grant TalkJS access. Read [Messaging investigation](docs/messaging-investigation.md). No undocumented endpoint, browser session, or extracted token is used.

AI, attachment uploads, full offer synchronization/management, processing-time/staff-productivity analytics, full access-history UI, inventory key rotation, and execution/recovery workers for external operations are pending. See [Implementation status](docs/implementation-status.md) and [Architecture](docs/architecture.md).

## Validation

Vitest exercises the integration client, privacy normalization, capability gates, encryption, CSRF/body limits, role logic, and actual SQL policies/functions in embedded PostgreSQL (PGlite). Playwright covers the disconnected workspace and navigation in Chromium. These tests are distinct from hosted Supabase Auth verification.

For a separate real PostgreSQL 17 migration/RLS/concurrency check, use a disposable container with **no network or published ports**:

```sh
docker run --detach --name rivox-postgres-check --label io.rivox.disposable-test=true --network none \
  -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine
# Wait for pg_isready to succeed inside this disposable container.
docker exec rivox-postgres-check pg_isready -U postgres
node scripts/verify-postgres.mjs
docker rm --force rivox-postgres-check
```

The verification script intentionally replaces only synthetic schemas in that dedicated test container. Never point it at a hosted or production database. Production authentication is never disabled.

```sh
npm run test:e2e
```

E2E starts an unconfigured app with integration bindings cleared; it never performs a live seller operation. Use `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` for a system Chromium, or install Playwright's bundled Chromium.
