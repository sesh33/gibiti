# Hosted Rivox operations

Production origin: https://rivox-control.vercel.app. Vercel runs the frontend and
server routes; Supabase stores accounts, sessions, permissions, listing/order
snapshots, rules, quotes, approvals, processed delivery records, audit and leases.
No browser extension, Eldorado session cookie, Docker or local process is needed
to use the published product.

## First use

1. The intended Owner opens the private expiring handoff, verifies their email,
   chooses their password and enrolls TOTP. The site has no shared default login.
2. In Settings, the Owner connects the existing Seller client secret. The client
   ID comes from server configuration. Saving tests an official order read first;
   only the server encrypts/stores the key and records the verified origin. No
   employee can retrieve it. A saved connection can be reverified without typing
   its secret again.
3. Synchronize orders and each needed offer source/page. Invite a trusted Admin
   reviewer using a private invitation link; each employee uses their own login.
4. Before any commercial action, inspect the exact listing/order and values.
   Staff request a change; a different eligible MFA reviewer approves it; an
   authorized participant confirms execution. Use Check outcome for an uncertain
   result. Never submit another change to try to recover an uncertain write.

The intended Owner is activated. The deployed project still needs its saved Seller connection.
The published sign-in form and anonymous access controls can be verified without
creating that identity. Successful official cloud reads are separate evidence;
they do not prove private reads from the Vercel application before connection.

## Pricing

Open a predefined offer's Edit / compare page. The Owner saves a minimum unit
price, difference below an equivalent competitor, decimal precision and mode.

- **Simulation** is the initial mode. It stores the computed quote and evidence
  without requesting a marketplace change.
- **Manual** requires a fresh simulation, explicit confirmation and a reason.
  The request refers to a server-owned quote; browser input cannot choose its
  amount. Independent approval and a fresh market/own-listing check follow.
- **Automatic** requires explicit per-offer consent, a different eligible MFA
  reviewer for that exact rule version, and the Owner's automatic-pricing master
  switch on the Automation page. Checks support a minimum interval of 15 seconds; actual cadence depends on provider latency, backlog and cooldowns. Up to three due items are processed serially per worker invocation. Changing the rule resets its review. No price
  below its saved floor or in a different currency is accepted, including through
  the ordinary manual price and full-details routes.

Only `result.offer` candidates with complete game/category, package, attributes,
environment/platform, unit/minimum purchase, delivery method/guarantee and volume
discount metadata are comparable. Currency must match. Own seller listings and
inactive/insufficient stock are excluded. Unknown active metadata, repeated rows,
missing pages, no equivalent competitors or more than five public pages block
recommendations and writes. Five pages is an application budget, not a vendor
quota. A safe blocked calculation can be expected for categories whose API does
not expose enough metadata; the app does not invent equivalence.

## Orders and delivery

Sold-order reads use `/api/v1/orders/me/seller/orders`,
`displayFilter=DisplaySellingOrders`, descending creation dates and cursor
pagination. Browser polling preferences persist per employee; hosted polling
has a separate Owner switch and durable catchup/backfill checkpoints.

Manual delivery marking is the default. It records that a transfer already
performed outside this app was completed; it does not transfer goods. Automatic
marking is off by default. It needs the workspace switch, a per-request opt-in,
an explicit actual-fulfillment attestation, a different authorized reviewer and
fresh eligible Paid state. Durable successful delivery records prevent a second
delivery even if a later upstream read is stale. A new restart/deployment never
clears that protection.

Cancellation and extension apply to Paid orders; public delivery correction is
available for Delivered orders. The dialog shows the order, product, buyer,
quantity and current state, plus the exact reason, time or corrected message.
Corrections are public delivery information, not inventory credential delivery.
HTTP acceptance is distinguished from independently observable state: extension
and correction text are not represented as independently verified when the
read contract omits the corresponding field.

## Hosted scheduler

The operator applies migrations through `202611130023_tool_rate_buckets.sql`,
then runs `scripts/configure-hosted-automation.py` with the Vercel project/team,
Supabase project ref and exact HTTPS origin. It uses provider administration
tokens only in the operator environment. It generates/reuses a separate worker
key in Supabase Vault and encrypted Vercel `CRON_SECRET`, installs pg_cron and the
HTTP extension, and schedules a private dispatcher every 15 seconds. Worker secrets
are not persisted in a shared HTTP request queue or cron command text. Vault and
the dispatcher deny staff/anonymous access. Ordinary redeployment preserves the
worker and inventory encryption keys.

After deployment, `--check-production` calls diagnostic mode from both the
operator and the database's HTTP transport. Diagnostic mode reads configuration
only and reports zero upstream writes. It never enters the commercial runner.
Default worker requests also select diagnostic mode unless explicitly set to run.

The dispatcher exits while all switches are off. Runtime switches can only be
enabled after a real read has been verified from the configured hosted origin.
The worker leases its database plan, rechecks current authority before sending
and claims an operation once. Lost/uncertain writes are reconciled with reads;
they are never replayed. Provider cooldowns and Retry-After persist across
instances. Uncheck automatic switches and save to stop new automatic writes;
an already-issued request can still finish. Disable background polling separately
to stop its reads. Supabase/Vercel project availability remains a hosting
dependency; no paid plan has been enabled by setup.

## Team replies

Templates are local EN/FR text for copying, with required order placeholders.
There is no general chat API or webhook integration in the supplied Seller API.
Copying a reply never claims it was sent. Employees who need actual chat still
need a separately authorized channel; API credentials do not grant that feature.

## Authentication evidence

The original generated-client dashboard explicitly supplied
`POST /api/authentication/seller/token` with clientId/clientSecret and a Bearer
access token expiring in 900 seconds. Real official reads have verified that
flow. The separate Cognito/IdToken documentation describes another integration
flow; the app does not switch to main-account passwords/cookies or bypass an
OAuth redirect allowlist. No Cognito redirect is used by client credentials.
Any actual production rejection or vendor bot-authorization requirement must be
resolved with Eldorado; none is inferred from an untested Vercel connection.

## Added Seller tools

The Seller center reads eligibility, restrictions, unread counts and notification
pages. Owner-only online/offline and permitted notification-read updates use
bodyless official commands, explicit confirmations and durable one-time claims.
HTTP acceptance is not represented as independently verified online status.
Uncertain actions remain locked until the Owner records an actual manual check
on Eldorado; this check sends no upstream mutation.

Reports use official sold-order-data/order-data CSV and invoice/generate PDF
endpoints with inclusive UTC dates. MFA, reports.export and full orders.read are
required. Downloads are limited to 10 MiB and 367 inclusive calendar days, escape
spreadsheet formulas in text cells and are released only after audit succeeds.

Selected-target batch editing prepares up to ten price, quantity or guaranteed
delivery changes from actual current values. Unknown details, changed currency
or violated floors block the preview. Ticket creation is atomic, while actual
marketplace requests remain independently reviewed/executed per listing.
