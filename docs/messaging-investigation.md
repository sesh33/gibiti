# Eldorado messaging: evidence and remaining questions

## Evidence available

The user-supplied Seller API order schema includes `talkJsConversationId`. The supplied endpoint list contains `POST /api/boostingOffers/boostingRequests/{boostingRequestId}/createConversationForSeller`, but contains no general conversation-history or send-message endpoint. A conversation identifier alone is not an authorization credential.

The development brief states that the documented public Seller API excludes messages. This has not been independently re-verified against the current account documentation.

## Official documentation checks performed

The following read-only documentation requests were attempted from this cloud environment:

| Source                                                       | Observed result                   |
| ------------------------------------------------------------ | --------------------------------- |
| `https://www.eldorado.gg/swagger/seller/index.html`          | HTTP 403                          |
| `https://talkjs.com/docs/Reference/REST_API/Authentication/` | Proxy tunnel denied with HTTP 403 |
| `https://support.eldorado.gg/en/`                            | Proxy tunnel denied with HTTP 403 |

These results establish an access limitation in this environment. They do **not** establish that an integration is available or unavailable, that the account is unauthorized, or that TalkJS credentials are missing. No undocumented endpoints were tried.

## Authorized access to request from Eldorado

Ask through the official support channel associated with the seller account:

> We operate a private seller workspace for our staff. Does Eldorado offer an officially supported way to list seller conversations, read/send messages and attachments, and receive message webhooks? Our order response contains `talkJsConversationId`. If direct TalkJS integration is supported, can Eldorado provision scoped application/user authentication and approved SDK or REST contracts? Please provide documentation, permitted use, scopes, rate limits, webhook verification requirements, and the integration-access request process.

Do not request access to Eldorado's application-wide TalkJS secret. A platform-owned app identifier discovered in a browser would not authorize an integration. No such identifier, cookie, or token has been extracted.

## Implementation boundary

`src/domains/messaging/provider.ts` defines the integration contract. The unavailable provider blocks all sends. `MockMessagingProvider` is opt-in, development-only, and rejected when `NODE_ENV=production`. It is not evidence of live messaging functionality.

The current production Smart Inbox remains empty and clearly labels its disconnected state. Attachments and AI sending remain disabled. An official provider must enforce conversation-level authorization, approved attachment handling, retry/idempotency rules, and authenticated webhook handling before being installed. Real read and send validation are required to mark the module complete.
