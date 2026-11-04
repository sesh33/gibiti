# Implementation and validation

## Implemented

- Individual staff accounts, Owner/Admin MFA, permission overrides, independently reviewed access changes and session revocation.
- Catalog-first entry for listing operators; assigned-order workers enter orders. Unavailable messaging is secondary and explicitly labeled.
- Official listing/order synchronization and minimized individual state reads. Currency GET-body transport is verified. Source overlap is disclosed.
- Individual pause/resume: explicit confirmation/reason, active session/permissions, snapshot checks, durable idempotency and shared native-ID locks. Results are verified upstream; uncertain responses are never automatically retried.
- Owner-issued private employee invitation links, with account-ownership-aware cleanup and auditing. Link capabilities stay out of query/mutation caches.
- Private verified-email first-Owner flow with default Supabase email links, own password and MFA. Verified cookies alone cannot create an Owner.
- Order assignments/notes, internal inventory reservations/reviewed consumption and scoped, currency-separated metrics.

## Current external evidence

Hosted Supabase received all 12 application migrations and records their versions. Anonymous callers cannot execute application RPCs; staff cannot execute bootstrap, ingestion or completion functions reserved for the server. Signup is disabled, minimum password length 14 and TOTP enabled. No intended Owner has been guessed or provisioned.

The Vercel production deployment reached READY at https://rivox-control.vercel.app. Login returned200, anonymous APIs401, cross-origin mutations403 and an invalid-account login401. CSP, HSTS, DENY frame protection and nosniff were confirmed. Supabase bindings and a persistent inventory encryption key are encrypted production variables. This does not establish a successful Owner onboarding or commercial change.

Official reads authenticated and returned 8 Currency orders in Received. Current catalog evidence: one Account/Active and one Currency/Closed; Currency appears in both predefined and currency sources. Items had no existing listing for individual-state validation and conservatively use returned-page checks.

Received means delivery confirmed; it does not prove released funds and is excluded from Completed volume. Unknown future states are not guessed as pending.

## Verification

- Full lint passed after the invitation-copy correction.
- Full unit/SQL/route suite: 213 passed, 2 live-read tests skipped by default.
- Opt-in real reads: 2 passed. No commercial mutations.
- Existing browser suite: 10 passed.
- Availability browser suite: 5 passed with intercepted APIs and zero real upstream writes.
- Production Webpack build and type checks passed. Turbopack's worker port is blocked by this environment; the official Webpack compiler is selected explicitly.
- Independent review found no critical privilege bypass in invitation, Owner or availability flows.

The earlier isolated local real-auth run passed 19 checks for MFA, invitations, staff RLS, stock, approvals and logout. It is not evidence that the intended Owner has completed the revised hosted flow. No fixture account is a user login.

## Remaining boundaries

1. Price, quantity, details, creation/deletion and delivery execution need official request bodies. Swagger explicitly returns User is unauthorized to access Swagger even with a fresh valid token. Exported OpenAPI/Request body schemas are required; no live payload is guessed.
2. No real commercial write was used as a setup test; synthetic validation is not live validation.
3. Eldorado secret transfer requires authorizing api.vercel.com on the existing proxy binding. The configuration tool cannot overwrite that target; no duplicate binding is created.
4. The official Seller API excludes messages; separate approved integration access is required.
5. Upstream subsequent-page contracts remain unverified; local pagination covers synchronized records only.
6. Default Supabase email delivery is restricted to project-team addresses. Employee private links avoid this SMTP dependency; general email delivery needs a configured provider.
7. Uncertain writes remain blocked until the desired state is observed. No price, quantity, details, deletion or automatic bulk changes are active.
