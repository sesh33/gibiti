# RIVOX Control — verified delivery status

## Working and validated

The application now runs against a real isolated local Supabase stack: PostgreSQL 17, GoTrue Auth, PostgREST and a local Mailpit receiver. This is real authentication and SQL/RLS, not a mock auth service. All migrations apply automatically through `npm run local`.

The real browser workflow validated:

- Explicit first Owner creation via private loopback-only setup, password authentication and real MFA enrollment/verification. The generated QR was decoded as a real authenticator QR, and a valid TOTP code was accepted.
- Official Eldorado token acquisition and **8 real orders** read and persisted. Real order details, chronological state history and internal notes work. .NET GUIDs, nullable listing titles, timestamp offsets and PostgREST unique-relation shapes are normalized correctly.
- **3 real listing categories** read and persisted: flexible, predefined and items. Local filtering/pagination are implemented. Currency requires further official request-contract verification; it returned HTTP 415 with the default request and HTTP 400 with JSON media type.
- Owner staff invitations delivered to local Mailpit, accepted from the actual email link, and password setup completed in the browser.
- A support employee initially sees no unassigned orders, gains access after assignment, cannot manage the team or request unauthorized cancellation, and loses access immediately after session revocation.
- Custom roles with granular overrides, independently MFA-reviewed assignment, visible custom labels, idempotent requests and revoked old sessions.
- Audited internal inventory creation, reservations, duplicate-allocation rejection, releases, and consumption only after a distinct reviewer approves it. No corresponding Eldorado order status was changed.
- Approval intent, duplicate-request handling, self-approval rejection, audit access, real per-currency analytics, and sign-out.

The standalone local real-auth workflow passed **19 checks**. Synthetic local staff/stock/notes/approval test records were removed afterwards. Real read-only order/listing snapshots remain in the local database; no fixture accounts or passwords are shipped.

## External integrations actually checked

| Service                 | Verified evidence                                                                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hosted Supabase project | Public Auth settings HTTP 200; service-role Auth administration HTTP 200; no existing Auth users; RIVOX tables absent (PGRST205).                          |
| Local Supabase          | All services healthy without ignoring health checks; migrations, real passwords, JWT/cookies, MFA, RLS, invitation email flow and operations validated.    |
| Eldorado                | Canonical `www.eldorado.gg` seller token POST 200; official order GET 200; flexible/predefined/item offer GETs 200. No real upstream commercial mutation.  |
| Official messaging      | No authorized read/send contract available. Swagger/support documentation access attempts were denied; no browser cookies or internal endpoints were used. |
| AI                      | No provider configured, no external processing. Local English reply templates are explicitly labeled templates and require human review.                   |

Native Node transport now uses the supported environment proxy, preserving TLS and credential routing. Loopback requests bypass that proxy. The canonical seller authentication host is used directly rather than replaying secrets through redirects.

## Remaining external prerequisites

1. **Hosted database:** API keys do not grant arbitrary SQL execution. No database connection password or Supabase Management API access token was supplied. To use the hosted project, apply the generated reviewed SQL bundle in its SQL Editor (or provide authorized migration access securely), disable public signup, configure SMTP/redirects, and create the intended verified Owner account. No hosted table/user/data was modified during this work.
2. **Messaging:** Eldorado must supply an authorized messaging contract/SDK access. The Smart Inbox states this clearly; production read/send remain unavailable. Mock messaging is opt-in and rejected in production.
3. **Commercial writes:** official payload/state-transition contracts plus explicit authorization for a single controlled real operation are still required. Approval records do not execute upstream cancellation/delivery/listing mutations.
4. **Currency listing pagination/request:** verify the official current request contract. No query/body is invented from response fields. Other returned listing pages report their coverage explicitly.
5. **AI:** a selected provider and approved privacy settings are required before translation or model-generated suggestions process buyer information. Sending remains a separate human-controlled action.
6. **Public deployment:** not authorized and not performed. The local launch is reproducible on a machine with Node.js and Docker Desktop.

## Verification commands

`npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`. Local full-stack validation: `RIVOX_SETUP_TOKEN_FILE=<private-path> npm run test:local -- --allow-live-reads` on a fresh local workspace only. Live read tests are opt-in with `RIVOX_LIVE_READS=true` and never send commercial mutations.

Unit/integration tests cover proxy-independent contracts, token refresh, privacy gates, cipher integrity, role/default/override consistency, SQL permissions, MFA assurance, session revocation, duplicate operations, approved role snapshots and stock concurrency. Browser tests cover the unconfigured workspace, accessibility and QR rendering; the separate real-auth run supplies integration evidence beyond those UI fixtures.
