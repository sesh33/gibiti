# Eldorado messaging: evidence and remaining questions

## Evidence available

The user-supplied Seller API order schema includes `talkJsConversationId`. The supplied endpoint list contains `POST /api/boostingOffers/boostingRequests/{boostingRequestId}/createConversationForSeller`, but contains no general conversation-history or send-message endpoint. A conversation identifier alone is not an authorization credential.

The development brief explicitly prohibits internal endpoints, session cookies, authenticated scraping, and reverse engineering. It requires a prepared adapter and a clearly disconnected inbox when official integration is unavailable. It also prohibits claiming that chat works without real reads and sends being validated.

On 2026-10-27, the current [official Eldorado help article, “How the seller API works”](https://support.eldorado.gg/en/articles/16127288-how-the-seller-api-works), was independently retrieved with HTTP 200. Under “What you can't do with the seller API,” it states:

> The Seller API covers offers and orders only. Use the website or the app for these: […] Messages, disputes and feedback.

This is direct evidence of the public Seller API's messaging boundary. It does not rule out a separately provisioned, officially approved partner integration. Existing seller API credentials alone do not establish access to one.

## Official documentation checks performed

The following read-only documentation requests were attempted from this cloud environment:

| Source                                                       | Observed result                   |
| ------------------------------------------------------------ | --------------------------------- |
| `https://www.eldorado.gg/swagger/seller/index.html` | HTTP 403 |
| `https://www.eldorado.gg/swagger/seller/swagger.json` | HTTP 403 |
| `GET /api/v1/orders/me/seller-api-docs`, with a fresh seller bearer token | HTTP 403 |
| `GET /api/v1/orders/me/seller-api-eligibility`, with the same token | HTTP 200 |
| `https://support.eldorado.gg/en/articles/16127288-how-the-seller-api-works` | HTTP 200; explicitly excludes messages |
| `https://support.eldorado.gg/en/articles/8408998-get-notified-about-new-messages-or-orders` | HTTP 200; describes website desktop notifications, not a messaging API |
| `https://talkjs.com/docs/REST_API/` | HTTP 200; requires TalkJS application administrator authentication |
| `https://talkjs.com/docs/Features/Security/Authentication.md` | HTTP 200; documents application-issued user authentication |
| `https://talkjs.com/docs/Features/Security/Secret_Keys.md` | HTTP 200; keys are managed by the TalkJS application owner |

These are the latest results from 2026-10-27. Earlier requests to the support and TalkJS sites were blocked by the environment; the successful retries supersede those reachability results. The old TalkJS `/docs/Reference/REST_API/Authentication/` URL now returns HTTP 404; the table uses the current official documentation paths.

The fresh seller authentication request succeeded with HTTP 200. Its access token remained in process memory, and no buyer data or credential values were printed. No undocumented endpoint was tried and no message was sent.

TalkJS REST access belongs to the TalkJS application whose data is being accessed. Its documentation says the REST API has read/write access to all application data and requires an administrator token issued with that application's secret. Creating an unrelated TalkJS application would not grant access to Eldorado conversations. RIVOX must not request or expose Eldorado's application-wide TalkJS secret. Any partner solution must be separately provisioned and approved by Eldorado, with documented delegation and conversation-level restrictions.

## Authorized access to request from Eldorado

Ask through the official support channel associated with the seller account:

> We operate a private seller workspace for our staff. Does Eldorado offer an officially supported way to list seller conversations, read/send messages and attachments, and receive message webhooks? Our order response contains `talkJsConversationId`. If direct TalkJS integration is supported, can Eldorado provision scoped application/user authentication and approved SDK or REST contracts? Please provide documentation, permitted use, scopes, rate limits, webhook verification requirements, and the integration-access request process.

Do not request access to Eldorado's application-wide TalkJS secret. A platform-owned app identifier discovered in a browser would not authorize an integration. No such identifier, cookie, or token has been extracted.

## Implementation boundary

`src/domains/messaging/provider.ts` defines the integration contract. The unavailable provider blocks all sends. `MockMessagingProvider` is opt-in, development-only, and rejected when `NODE_ENV=production`. It is not evidence of live messaging functionality.

The current production Smart Inbox remains empty and clearly labels its disconnected state. Attachments and AI sending remain disabled. An official provider must enforce conversation-level authorization, approved attachment handling, retry/idempotency rules, and authenticated webhook handling before being installed. Real read and send validation are required to mark the module complete.

Staff can use RIVOX's permissioned order context, assignments, internal notes, and inventory without receiving Eldorado account credentials. This does not currently enable them to read or answer buyer messages. A deployed website must preserve that distinction; deployment or Supabase/Vercel administration tokens do not change the messaging authorization boundary.
