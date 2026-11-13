# Eldorado catalog contracts

The official [Seller API help article](https://support.eldorado.gg/en/articles/16127288-how-the-seller-api-works) confirms offer creation, editing, pause/resume, price/quantity changes, delivery-time changes, CSV imports and order operations. It also states that there is no test environment. Read validation must not be described as a successful live commercial write.

## Currency search

An authorized read on 2026-11-02 verified this exact request shape:

```http
GET https://www.eldorado.gg/api/v1/currency-management/me/offers
Authorization: Bearer <seller-access-token>
Content-Type: application/json

{"augmentedGameFilter":{}}
```

The HTTP method remains `GET`; its JSON body is required. A request without JSON media type returned 415, JSON media type without a body returned 400 for `request`, and `{}` returned 400 for `AugmentedGameFilter`. The request above returned 200 with `pageIndex`, `pageSize`, `recordCount`, `totalPages` and `results`. The existing sanitized offer parser accepts its results.

Browser Fetch and Undici Fetch prohibit a GET body. `currencyOffersFetch` therefore uses Undici's HTTP request API for this one fixed canonical URL and body. It shares the supported proxy dispatcher, keeps TLS verification enabled, does not follow redirects, retains `Retry-After`, and does not forward upstream cookies. It rejects arbitrary URLs, queries, methods and bodies. No currency pagination/filter body beyond this initial-page request is enabled.

`RIVOX_LIVE_READS=true npx vitest run tests/live-read.test.ts` validates authorized order reads and all four catalog read endpoints without sending writes. The two live-read tests passed after this transport was added.

## Individual listing state

Authorized GETs to `/api/flexibleOffers/{id}/private`, `/api/predefinedOffers/{id}/private`, and `/api/v1/currency-management/me/offers/{id}` returned 200 with an envelope containing `offer`, `user`, `userOrderInfo` and `deliveryTime`. The nested `offer` contains `id` and `offerState`.

`EldoradoClient.offerState` validates the requested GUID and exact source route, accepts only the nested matching identifier/state, and discards the rest of the envelope. This allows a post-action state check even when a paused listing disappears from the default search page. No individual item read is enabled without a verified response contract.

## Catalog overlap and state

Catalog families are not necessarily disjoint. The latest authorized reads returned a currency listing through both predefined and currency routes, using the same native offer identifier. Source-qualified storage identifiers must not be counted as unique marketplace listings without deduplicating `native_id`.

Observed offer states include `Active` and `Closed`. A closed listing must not be treated as a paused listing merely because it is not active. Availability changes need an explicitly supported state transition and an actual authorized operator action.

## Received order state

The official [Receive your order](https://support.eldorado.gg/en/articles/8408993-receive-your-order) article says a delivered order becomes `Received` when the buyer confirms, or automatically after three days. It distinguishes `Received`/`Completed` from orders still in progress. A received order must therefore not count as pending delivery.

The official [TradeShield protection for sellers](https://support.eldorado.gg/en/articles/8409006-tradeshield-protection-for-sellers) article states that the category's fund-release period starts **after** the order is marked `Received`. Delivery confirmation is not evidence that funds have reached the seller's balance. Neither these order states nor catalog prices authorize a financial balance/available-revenue claim.

## Documented availability routes

These exact methods and routes come from the user-supplied Seller API endpoint list:

| Family | Pause | Resume |
| --- | --- | --- |
| Flexible | `PUT /api/flexibleOffersUser/me/{id}/pause` | `PUT /api/flexibleOffersUser/me/{id}/resume` |
| Predefined | `PUT /api/predefinedOffersUser/me/{id}/pause` | `PUT /api/predefinedOffersUser/me/{id}/resume` |
| Items | `POST /api/v1/item-management/me/offers/{offerId}/pause` | `POST /api/v1/item-management/me/offers/{offerId}/resume` |
| Currency | `PUT /api/v1/currency-management/me/offers/{id}/pause` | `PUT /api/v1/currency-management/me/offers/{id}/resume` |

No commercial mutation was used to discover their request or response behavior. The public Swagger index and JSON, and the authenticated seller documentation endpoint, still returned 403 during the latest review. Price, quantity and order-delivery request bodies must not be guessed from these route names or read-response fields.

## Editing request contracts still required

On 2026-11-04, a fresh seller token was accepted (authentication HTTP 200 and seller eligibility HTTP 200), but both the Swagger index and Swagger JSON returned HTTP 403 even with that bearer token. The error explicitly says `User is unauthorized to access Swagger.` The authenticated seller documentation endpoint also returned HTTP 403. This is a documentation authorization boundary, not evidence that the seller credentials have expired.

The official help article links the seller dashboard and token endpoint, but does not publish the editing payloads. The supplied endpoint list proves the routes exist; it does not establish their JSON fields, required parameters, currency/precision constraints, validation rules, or successful response contracts. A GET response is not a write request schema.

An authorized operator can unblock implementation by exporting the OpenAPI document from their Swagger session, or copying **Request body → Example Value and Schema**, plus parameters and response definitions, for these routes. This requires no `Execute` operation and no actual offer change:

| Editing scope | Official listed route |
| --- | --- |
| Flexible account price | `PUT /api/flexibleOffersUser/me/{id}/changePrice` |
| Flexible account details | `PUT /api/flexibleOffers/account/{id}/details` |
| Currency price | `PUT /api/v1/currency-management/me/offers/{id}/change-price` |
| Currency quantity | `PUT /api/v1/currency-management/me/offers/{id}/change-quantity` |
| Currency details | `PUT /api/v1/currency-management/me/offers/{id}` |
| Predefined price | `PUT /api/predefinedOffersUser/me/{id}/changePrice` |
| Predefined quantity | `PUT /api/predefinedOffersUser/me/{id}/changeQuantity` |
| Predefined details | `PUT /api/predefinedOffers/{id}/details` |
| Item price | `PUT /api/v1/item-management/me/offers/{offerId}/price` |
| Item quantity | `PUT /api/v1/item-management/me/offers/{offerId}/quantity` |
| Item details | `PUT /api/v1/item-management/me/offers/item/{offerId}/details` |

An export must omit authorization headers, client secrets, account credentials, and real buyer information. Payload discovery must not use live price/quantity changes, invalid-target mutation probes, authenticated UI scraping, or attempts to bypass Swagger authorization. Until these contracts are available, pause/resume is the only implemented upstream editing action; this release must not be described as complete offer editing.

## Latest access check: 2026-11-13

The user-supplied Swagger index was opened in Chromium with a fresh Seller bearer token sent only to the official Swagger origin/path. It returned 403 with `User is unauthorized to access Swagger` and zero operation blocks. The seller-api-docs endpoint returned 200 with brief textual route-family notes; it was not an OpenAPI document and supplied no write DTOs. Newly supplied Swap routes are acknowledged, but request/response contracts are still needed before enabling Swap operations. The access-token credentials remain valid for the verified order, listing and status reads.

## Supplied contracts now implemented

After the blocked browser check, the user supplied the extracted request schemas and response/status contracts in this conversation. See [the current Seller contract handoff](eldorado-seller-contracts.md). The previous missing-contract status is historical: reviewed predefined creation/details/price/quantity and v1 order delivery/cancellation/extensions are now implemented. Other catalog-family edit bodies, bulk actions, deletion and gift-card secret import DTOs remain unimplemented. Predefined source pagination and documented selling-order cursors are supported.
