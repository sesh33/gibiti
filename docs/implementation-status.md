# Implementation and validation

## Implemented

- Individual accounts, Owner/Admin MFA, overrides, independent access reviews, session revocation and scoped RLS. Employees do not receive Eldorado account credentials or API secrets.
- Owner-only connection setup: official read validation before encrypted credential storage, active Owner session recheck, no secret readback, no browser/query/mutation-cache retention and secret-free audit. The persistent inventory master key derives a separate integration key.
- Orders with documented selling filters/cursors, local pagination, assignments, notes, history and Received/Completed distinction. Browser read-only polling preferences persist per employee. Separate hosted polling is explicitly authorized by the Owner, uses durable catchup/backfill cursors and runs while browsers are closed. Both respect provider backoff/Retry-After; the shared cooldown is persistent across serverless instances.
- Catalog reads for flexible/predefined/items/currency. Predefined upstream pages are selectable. Currency uses its verified GET JSON-body transport. Source aliases are not counted as unique listings; Closed is not Paused.
- Individual pause/resume with confirmation, durable idempotency, shared target locks and actual state verification.
- Predefined graphical creation/details editor with advanced attributes/discounts, individual price and integer-JSON quantity changes. Independent approval, explicit one-time execution, MFA and fresh preflight/postflight reads. Full details require create + price + stock permissions at request, approval and execution.
- Manual mark-delivered, cancellation and delivery extension for currently Paid orders, plus reviewed delivery-data correction for Delivered orders, using the supplied v1 contracts. A successful delivery creates a permanent tombstone; stale Paid reads cannot authorize another delivery.
- Marketplace operations share locks across listing adapters and availability routes. Uncertain writes are never resent; Check outcome performs reads only. Provider 4xx rejections, ambiguous timeouts and result-persistence failures are distinguished.
- Public informational comparison plus complete-market repricing simulations. Simulations require exact package/environment/attributes, game/category/currency, unit/minimum purchase, delivery method/guarantee and volume discounts; exclude own-seller listings and unavailable stock. Unknown active metadata, duplicate rows or pagination beyond the five-page application budget block recommendations/writes.
- Durable per-listing floor/difference/precision/mode rules default to simulation. Quoted manual requests are atomically tied to server-computed quotes and need confirmation/review. Fresh market checks and database floors also guard full-details replacement and manual price routes.
- Hosted automatic pricing needs Owner opt-in, a different MFA policy reviewer and the workspace master switch. Delivery marking needs actual-fulfillment attestation, per-request opt-in, independent approval, fresh Paid state and persistent idempotency. Worker lease/authority is checked before the request; uncertain writes are only reconciled. All automation switches remain off at delivery.
- English/French reply library for Donut SMP, Roblox, delivery problems and refunds. Required placeholders must be filled before copying; no message is sent.
- Internal inventory encryption/reservation/reviewed consumption, currency-separated metrics, staff invitation links and default Supabase verified-email Owner activation.
- Seller center with official eligibility/restriction/count reads and notification pages, permissioned read-state updates, Owner-only account availability commands, durable idempotency and explicit manual recovery.
- Official sales/orders CSV and invoice PDF downloads with MFA, full-order/export permission, independent throttling, private responses, spreadsheet formula escaping and release only after audit succeeds.
- Batch previews for up to ten exact predefined offers: price, primitive integer quantity and safely preserved delivery-time details. All review tickets are created atomically; each listing retains its independent review/execution and fresh floor/state checks.
- Eight-decimal unit-price display, representable micro-undercut validation, 15-second minimum rule intervals, bounded three-pass queue drain and a persisted repricing monitor. Actual cadence depends on request latency, workload and provider backoff. The database scheduler supports a real 15-second schedule.
- Public per-installation branding and a clean customer source kit generator. Each customer uses a separate Vercel/Supabase project, encryption keys, Owner and Seller credentials. No customer resources were created.

## External state

The existing Supabase project was restored from INACTIVE on 2026-11-13 and reached ACTIVE_HEALTHY. All 21 forward migrations and their history are applied. The integration credential table and completion RPCs deny anonymous/authenticated access; guarded request/claim functions verify current permissions and sessions.

The authorized Vercel origin is https://rivox-control.vercel.app. Production Supabase bindings and the persistent encryption key are configured. The intended Owner was not guessed or provisioned; activation uses their own verified email/password and MFA. The scoped cloud Eldorado secret was not copied as a placeholder into Vercel: the Owner connects it through Settings.

Fresh official reads passed for orders (including a subsequent cursor page), all four listing adapters, individual listing states, predefined private fields, public comparable listings and seller status counts. The documented selling filter returned more orders than the old default page; a real nullable cancellation message exposed and fixed an order parser issue. No buyer payload was logged during diagnosis.

The Swagger browser session still returned explicit 403. The user supplied the schemas extracted from their authenticated session; those supplied contracts define the new actions. Two authentication examples exist in the materials: the generated Seller client token/Bearer flow was explicitly supplied by the original API dashboard and verified with real authorized reads. No main-account password or Cognito cookie fallback is used.

## Validation

- Full lint and strict TypeScript checks.
- Unit, SQL and route suite: 326 passed, with 4 live tests skipped by default.
- Opt-in real read suite: 4 passed, with zero commercial mutations.
- Browser suite: 11 passed, covering navigation, MFA QR, disconnected messaging, copying replies, the new editor and responsive layouts.
- Isolated real-component checks cover availability recovery, encrypted connection UI and the reviewed marketplace workflow, using intercepted APIs only. Marketplace checks: 15 passed; availability: 5; connection isolation/cache checks passed.
- Production uses the supported Next.js Webpack compiler; types/security checks remain enabled.

## Limits and remaining human steps

1. The production database now has one active Owner and zero saved Seller connections at the last check. The Owner must connect Eldorado in Settings and synchronize. A successful local/cloud read is not a verified private read from Vercel; the hosted origin is recorded only after that server completes the read. Independent review needs a second authorized account; invite a trusted Admin reviewer before testing commercial actions.
2. Real commercial actions have not been executed as setup tests. The API has no sandbox. Actual fulfillment must be completed/verified before marking an order delivered.
3. Creation records HTTP 201 acceptance and refreshes the catalog. Details check observable product/pricing/delivery fields; unknown nested attribute schemas are acknowledged from successful API responses without claiming a full metadata round trip. Extension records HTTP 204 acceptance and rereads the order; it does not invent a verified deadline when deliveryTime is absent.
4. Gift-card secret imports require a separate encrypted workflow/schema. The editor accepts null/empty giftCardDetails. Unknown game/attribute IDs are never generated. Provider business validations can still reject a valid schema; HTTP rejection messages are sanitized and no write is retried automatically.
5. Other catalog-family price/details/stock contracts, Swap, boosting workflows, provider-wide bulk writes and deletion are not enabled. Selected-target batches use individual documented routes. Other source pagination remains limited to verified initial reads.
6. The official Seller API excludes chat and has no registered webhooks. Reply templates are manually copied. No Eldorado mailbox/password is shared with staff.
7. Default Supabase mail is restricted to project-team recipients; first Owner uses their project email. Employee private invitation links avoid SMTP. Free Supabase may pause after inactivity; no paid plan was enabled.
8. This is a private workspace for one seller account. The requested commercial model is one isolated installation per customer. Shared-database multitenancy and subscription billing are not implemented or needed for this distribution model.
