# Seller contracts supplied on 2026-11-13

Source: the user extracted these contracts from their authorized Rivox Swagger session. Our separate Chromium session cannot access the Swagger schemas (HTTP 403); the supplied contracts, rather than guessed request DTOs, define the new adapters.

## Authentication evidence

Two authentication examples were supplied. The generated Seller client credentials shown in the user's original Eldorado API dashboard explicitly specify `POST /api/authentication/seller/token`, `clientId` / `clientSecret`, a 900-second access token and `Authorization: Bearer`. That flow authenticated and performed authorized real reads in this environment. The separate documentation text describes Cognito and an IdToken cookie. We retain the working, explicitly supplied Seller client flow and do not obtain/store the main Eldorado email/password, scrape cookies, or switch auth methods automatically. If Eldorado withdraws client-credential access or requires separate bot authorization, that must be resolved with Eldorado; no undocumented fallback is enabled.

The authenticated read and write adapters send the documented fixed `swagger: Swager request` header. Optional `api-version` is omitted. Order mutations use the `/api/v1/orders/` family.

## Operational application rules

Requests are immutable and independently reviewed. Execution requires MFA, current permission, an active session, a one-time database claim, a fresh target read and contextual confirmation. Price/stock edits operate on predefined listings; other listing adapters retain pause/resume. Full-details replacement requires `offers.create`, `offers.update_price` and `offers.update_stock`, so it cannot bypass a denied price or stock permission.

The app accepts giftCardDetails null/empty only; sensitive code imports require a separately specified, encrypted workflow. Public game attributes are preserved as explicit JSON because their nested request schema was not supplied. No IDs are invented. The editor offers regular fields plus an advanced document for attributes and discounts.

Order actions are restricted to currently Paid orders. No delivery automation is enabled. A permanent successful-delivery record prevents another delivery even if a later read is stale. Polling is opt-in while the order page is visible, with configurable intervals and backoff; application throttles are not represented as Eldorado's quota.

Price, quantity, delivery and cancellation are checked against fresh actual values/state. Details verify observable product/pricing/delivery fields; environment/attribute acceptance is acknowledged from the successful response without claiming a complete round trip for their unspecified schemas. Creation records HTTP 201 acceptance and refreshes the catalog. An extension's HTTP 204 acceptance is recorded separately from independent deadline verification. Lost/ambiguous writes remain locked and are never automatically replayed.

Public comparison is informational: same game/category, currency, unit, minimum purchase, environment, attributes and delivery method; Active with stock only. Incomplete metadata is blocked, page scope is disclosed, and no automatic price recommendation or repricing is offered. No automatic process can lower a price below a configured floor because no automatic price writes exist.

## Supplied endpoint and schema text

1) MINHAS OFERTAS

GET /api/predefinedOffers/me
Autenticado. Query opcional:
- offerState
- gameId
- category
- tradeEnvironmentId
- tradeEnvironmentValue0
- tradeEnvironmentValue1
- tradeEnvironmentValue2
- queryAttributes
- pageIndex: mínimo 1, máximo 1000
- pageSize: mínimo 1, máximo 50
- api-version

`queryAttributes` é um mapa de ID de atributo para array de valores, por exemplo:
{"attribute-id":["value1","value2"]}

Resposta paginada:
- pageSize
- results
- pageIndex
- totalPages
- recordCount

Os itens retornados são ofertas privadas próprias; seus campos ficam diretamente no item (por exemplo `id`, `offerState`, `quantity`, `pricePerUnit`).

GET /api/predefinedOffers/{id}/private
Autenticado; id é UUID. Busca a visão privada da oferta. Respostas documentadas: 200 ou 404.

2) OFERTAS PÚBLICAS PARA COMPARAÇÃO DE PREÇO

GET /api/predefinedOffers/game
Query:
- gameId
- category
- tradeEnvironmentId
- tradeEnvironmentValue0/1/2
- queryAttributes
- pageIndex: 1–1000
- pageSize: 1–50
- api-version

Resposta é paginada. Cada `results[]` é um grupo com estrutura:
{
  "offer": { ...dados da oferta pública... },
  "user": { ...dados públicos do vendedor... },
  "userOrderInfo": { ...avaliações/resumo público... },
  "deliveryTime": { ...mediana e previsão... }
}

Os campos relevantes estão em `result.offer`, incluindo:
- id, userId, gameId, category, gameCategoryTitle
- quantity, minQuantity
- pricePerUnit, pricePerUnitWithDiscount, pricePerUnitInUSD
- exchangeRate, discountPercentage
- guaranteedDeliveryTime, offerState
- deliveryMethod, unitSystem
- attributes, offerAttributeIdValues, tradeEnvironmentValues

Comparação: use ofertas ativas e com estoque, do mesmo jogo/categoria, plataforma/ambiente, seleção de pacote/atributos, método de entrega e unidade. Compare o preço na mesma moeda; use `pricePerUnitInUSD` ou a taxa retornada pela API quando apropriado. Não trate ofertas de quantidades/pacotes diferentes como concorrentes equivalentes. Se não conseguir identificar atributos ou pacote com segurança, não recomende nem aplique mudança.

Enums úteis:
- category: Account, CustomItem, Currency, Boosting, RequestedBoosting, ManagedBoosting, TopUp, GiftCard
- deliveryMethod: Unspecified, EpicGifting, IslandDelivery, GamePass, MailTrade, AuctionHouse, InGameTrade, RedeemCode, AutoClaim, LoginMethod, Donation
- offerState: Active, Paused, Closed, Offline
- unitSystem: Unit1, Unit1000, Unit1000000, Unit1000000000, Unit1000000000000, Unit1Quadrillion, Unit1Quintillion, Unit1Sextillion, Unit1Septillion, Unit1Octillion, Unit1Nonillion, Unit1Decillion

3) MUDAR PREÇO, QUANTIDADE E DISPONIBILIDADE

PUT /api/predefinedOffersUser/me/{id}/changePrice
Autenticado; `id` UUID.
Corpo MoneyBaseDTO:
{"amount":1.09,"currency":"USD"}
- amount: number/double
- currency: enum string
- resposta 200: MoneyBaseDTO

PUT /api/predefinedOffersUser/me/{id}/changeQuantity
Autenticado; `id` UUID.
Corpo: inteiro JSON int32 direto, por exemplo `5`.
NÃO enviar {"quantity":5}.
Resposta 200: inteiro int32.

PUT /api/predefinedOffersUser/me/{id}/pause
PUT /api/predefinedOffersUser/me/{id}/resume
Autenticado; `id` UUID; sem corpo; resposta 200.

A API também tem operações em lote. Não as acione automaticamente:
- PUT /api/predefinedOffersUser/me/pauseAllActive
- PUT /api/predefinedOffersUser/me/resumeLatestPaused/{gameId}
- PUT /api/predefinedOffersUser/me/changeDeliveryTimeForAll
- PUT /api/predefinedOffersUser/me/changePriceForAll/{gameId}

`changeDeliveryTimeForAll` exige query `deliveryTime`.
`changePriceForAll/{gameId}` exige query `amount` e `currency`.
As duas aceitam filtros opcionais de oferta, incluindo gameId/category/ambiente/atributos, e retornam contagem de ofertas afetadas.

Há ainda rotas de exclusão:
- DELETE /api/predefinedOffersUser/me/{id}
- DELETE /api/predefinedOffersUser/me/deleteAll
Não chamar nem oferecer ação em lote de exclusão sem uma confirmação explícita e específica do usuário.

Enum de moeda:
USD, EUR, GBP, AUD, CAD, JPY, BRL, SGD, CHF, SEK, DKK, NOK, NZD, THB,
HKD, CZK, SAR, PLN, AED, MXN, RON, ILS, ARS, TRY, QAR, HUF, PEN, KWD,
BGN, CLP, COP, IDR, PHP.

4) CRIAR E EDITAR DETALHES DE OFERTA (SE FIZER PARTE DO APP)

POST /api/predefinedOffers
Cria oferta; resposta 201.

PUT /api/predefinedOffers/{id}/details
Edita detalhes; id UUID; resposta 200.

Ambas recebem `PredefinedOfferPrivateDTO`:
{
  "details": {
    "description": "Descrição",
    "guaranteedDeliveryTime": "Minute20",
    "pricing": {
      "quantity": 1,
      "minQuantity": 1,
      "volumeDiscounts": [],
      "pricePerUnit": {
        "amount": 1.09,
        "currency": "USD"
      }
    },
    "deliveryMethod": "InGameTrade"
  },
  "augmentedGame": {
    "gameId": "ID_DO_JOGO",
    "category": "CustomItem",
    "tradeEnvironmentId": null,
    "offerAttributes": []
  },
  "giftCardDetails": []
}

Regras do schema:
- DTO principal exige `details`, `augmentedGame`, `giftCardDetails`.
- `augmentedGame` exige `gameId` e `category`.
- `pricing` exige `quantity`, `minQuantity`, `pricePerUnit`.
- `pricePerUnit` exige `amount`, `currency`.
- cada `volumeDiscounts[]` exige `quantity` e `percentage`.
- `giftCardDetails` deve estar presente; pode ser null ou lista.
- objetos declaram `additionalProperties:false`; não enviar propriedades extras.
- Confirmar game/category/atributos e valores válidos via biblioteca/dados do jogo antes de criar ou editar oferta. Não inventar IDs de atributo.

`guaranteedDeliveryTime` enum:
Minute20, Hour1, Hour5, Hour12, Day1, Day2, Day3, Day7, Day14, Day28,
Instant, Minute5, Day45, Day60, NotApplicable, Hour2, Hour3, Hour8,
Automated, Day5, Day10, Day80, Day100.

5) PEDIDOS — LISTAGEM E PAGINAÇÃO

GET /api/v1/orders/me/seller/orders
Autenticado. Query:
- `displayFilter`: obrigatório; para pedidos do vendedor usar `DisplaySellingOrders`
- `query`
- `orderState`
- `isAscendingDateOrder`
- `ignorePendingReviewOrders`
- `gameId`
- `category`
- `filterByActiveWarranty`
- `cursorValue`
- `cursorColumn`
- `pageDirection`
- `pageSize`: mínimo 1, máximo 50
- `orderGroup`

Enums:
- displayFilter: DisplayBuyingOrders, DisplaySellingOrders
- orderState: Paid, Disputed, Delivered, Received, Completed, Canceled, PendingReview
- pageDirection: Next, Previous
- orderGroup: Regular, Historical

Resposta cursor-paginada:
- results
- pageSize
- cursor
- pageDirection
- previousPageCursor
- nextPageCursor

Use `nextPageCursor`/`previousPageCursor` para continuar; não use paginação por pageIndex nessa rota.
Campos importantes no item de pedido incluem id, offerId, purchaseQuantity, totalPrice, state,
stateLogs, orderOfferDetails, createdDate, deliveryStartedDate, deliveryTime, buyerUsername,
isHistorical e flags de disputa/garantia. Trate subobjetos opcionais como null.

6) AÇÕES DE PEDIDO

PUT /api/v1/orders/me/{orderId}/deliver
Autenticado; orderId UUID; sem corpo; resposta 200 com OrderGetSellerPrivateDTO.
Só entregar pedidos elegíveis/confirmados como pagos. Autoentrega precisa ser opt-in claro;
por padrão, manter modo manual. Persistir IDs já processados, bloquear concorrência e nunca
enviar duas entregas ao mesmo orderId, inclusive após reinício.

POST /api/v1/orders/me/{orderId}/cancel
Corpo:
{"reason":"Out_Of_Stock","message":"Mensagem opcional"}
`reason` obrigatório; `message` string nullable.
SellerCancelationReason:
Mutual_Agreement,
Boost_Couldnt_Be_Completed_Due_To_Account_Issues,
Buyer_Provided_Incorrect_Account_Information,
Poor_Boosting_Quality,
Failed_To_Meet_Timeline,
Out_Of_Stock,
Buyer_Does_Not_Meet_Criteria_For_Order,
Buyer_Does_Not_Need_It_Anymore,
Account_Listed_Incorrectly,
Access_To_Account_Lost,
Buyer_Asked_For_A_Refund_Due_To_Dissatisfaction,
Buyer_Did_Not_Respond,
Cancelation_Of_Reserved_Order,
Seller_Going_Offline,
No_Sellers_Available,
Other.

POST /api/v1/orders/me/{orderId}/extend-delivery-time
Corpo:
{"time":"Hour1","reason":"PreparationDelay","message":"Mensagem opcional"}
`time` e `reason` obrigatórios; `message` string nullable.
time enum: None, Minute5, Minute15, Minute30, Hour1, Hour3, Hour6.
reason enum: None, WaitingForBuyer, InGameCoordination, PreparationDelay, TechnicalIssue.
Resposta 204 sem corpo.

POST /api/v1/orders/me/{orderId}/delivery-details/correction
Corpo:
{"message":"Texto da correção"}
Schema marca `message` obrigatório, embora nullable; resposta 200.

7) DIAGNÓSTICO E DADOS AUXILIARES

GET /api/v1/orders/me/seller-api-eligibility
Retorna elegibilidade da Seller API.

GET /api/v1/orders/me/seller-api-docs
Retorna conteúdo da documentação de autenticação e uso.

GET /api/v1/orders/me/pending-review-order-count
GET /api/v1/orders/me/sold-order-data?fromDate=...&untilDate=...
GET /api/v1/orders/me/order-data?fromDate=...&untilDate=...
GET /api/v1/orders/me/invoice/generate?fromDate=...&untilDate=...

A documentação informa que não há registro de webhooks no momento. Para novos pedidos,
usar polling com intervalo configurável, backoff e respeito às respostas 429/headers de
rate limit. Não assumir cota numérica sem dado oficial.

8) INTERFACE E PROTEÇÕES NECESSÁRIAS
- Mostrar estado de conexão e erro sem expor credenciais/tokens.
- Mostrar loading, vazio, falha de rede, 401/403, 404, 429 e sucesso.
- Após mudança bem-sucedida, reler a oferta/pedido da API e atualizar a interface com o
  valor real retornado.
- Validar UUID, preço positivo, moeda, quantidade inteira e campos exigidos antes da chamada.
  Não inventar limites máximos não definidos no Swagger.
- Nunca baixar o preço automaticamente abaixo do piso configurado pelo usuário.
- Antes de aplicar repricing, reconsultar os concorrentes e garantir que a comparação ainda é
  válida. Se a coleta estiver incompleta/ambígua, bloquear a escrita.
- Dar prioridade a operações de leitura; não repetir automaticamente POST/PUT de escrita após
  timeout sem confirmar estado, pois a primeira chamada pode ter sido processada.
- Redigir logs: remover senha, IdToken, cookie e headers sensíveis.
- O Swagger não lista API geral para enviar mensagem de chat ao comprador. Também não há
  registro de webhooks. Não prometer autoenvio de mensagens por Seller API; usar apenas
  conteúdo local copiável, a menos que uma API oficial específica seja descoberta.
- Para ações irreversíveis (cancelar, entregar, excluir ou alterar várias ofertas), usar
  confirmação contextual, mostrar o item/quantidade afetados e registrar resultado.

Antes de finalizar, compare a implementação com estes caminhos, não invente payloads quando
o Swagger não define o contrato e sinalize qualquer ponto que dependa de autorização da
Eldorado ou de uma regra não documentada.

A descoberta que muda o handoff é a autenticação: a documentação Seller API usa Cognito + IdToken no cookie __Host-EldoradoIdToken e recomenda contatar api@eldorado.gg para autorizar bots.