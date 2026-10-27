# RIVOX Control

Private seller operations and customer support workspace: Next.js App Router, strict TypeScript, Tailwind/Radix UI, Supabase Auth/PostgreSQL/RLS, TanStack Query and Zod.

## Start on localhost

Requires Node.js **22.19+** and a running Docker Desktop/Engine.

```sh
npm ci
npm run local
```

This starts a real local database and Auth service, applies migrations and opens a private Owner setup flow. Read the token file whose path is printed in the terminal, create your own local Owner account, and enroll MFA. No default password is shipped. See [localhost instructions](docs/localhost.md).

To synchronize real orders and listings, put your `ELDORADO_CLIENT_ID` and `ELDORADO_CLIENT_SECRET` in ignored `.env.local` or secure process bindings. Never paste secrets in chat or commit them. Supabase bindings are generated automatically for local mode; the hosted project remains separate.

## Verified operation

- Real Owner login/MFA, employee invitation email acceptance, individual permissions and scoped order assignments.
- Real official read-only Eldorado authentication and **8 orders** synchronized; **3 listing categories** synchronized.
- Full order context, notes, custom role profiles, independently reviewed access changes and session revocation.
- Audited inventory/reservation/release/reviewed consumption, duplicate protection and per-currency analytics from synchronized records.
- Smart Inbox with persistent filters, English templates and an isolated provider contract. **Official messaging is not connected.** No simulated messages are presented as live data.

The isolated real-auth browser workflow passed **19 checks**. Test accounts and stock fixtures were removed afterwards. The app is a working local operations release, not a claim that every production acceptance criterion or external integration is complete.

## Quality

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Live reads are opt-in: `RIVOX_LIVE_READS=true npm run test:live-reads`. The full local real-auth check is `RIVOX_SETUP_TOKEN_FILE=<private-path> npm run test:local -- --allow-live-reads` on an otherwise fresh local workspace; it refuses to overwrite an existing Owner. No real Eldorado order/listing mutation is performed by these tests.

## Hosted deployment

API service keys cannot execute migrations. Generate a guarded, reviewable first-install SQL bundle with `npm run db:bundle`, then follow [secure hosted setup](docs/deployment.md). No hosted schema, Auth user or public deployment was created by this work.

Live delivery/cancellation/offer mutations await verified official payload/state-transition contracts and explicit authorization. Currency listing requests need their current official contract. AI awaits a provider/privacy configuration. Real messaging requires authorized Eldorado access; `talkJsConversationId` is only a reference.

[Verified status and remaining prerequisites](docs/implementation-status.md) · [Architecture](docs/architecture.md) · [Messaging investigation](docs/messaging-investigation.md)
