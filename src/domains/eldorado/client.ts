import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import {
  sellerAction,
  reportRequest,
  type SellerAction,
} from "./seller-contracts";
import { eldoradoRateStore, type ProviderRateStore } from "./rate-store";
import {
  resolveSellerCredentials,
  sellerConnectionStatus,
  type SellerCredentials,
} from "./credentials";
import type { OfferSource } from "@/domains/offers/definitions";
import {
  marketplaceChange,
  predefinedInput,
  type MarketplaceChange,
} from "./contracts";
import {
  currencyOfferSearchBody,
  currencyOffersFetch,
  serverFetch,
} from "@/lib/server-fetch";

// The apex host redirects POST to www. Use the canonical, explicitly authorized
// origin directly so credentials are never replayed through an arbitrary redirect.
const origin = "https://www.eldorado.gg";
const documentedReads = new Set([
  "/api/v1/orders/me/seller/orders",
  "/api/v1/orders/me/seller-api-eligibility",
  "/api/v1/orders/me/pending-review-order-count",
  "/api/notifications/me/unread-count",
  "/api/notifications/me",
  "/api/v1/orders/me/sold-order-data",
  "/api/v1/orders/me/order-data",
  "/api/v1/orders/me/invoice/generate",
  "/api/offerUser/me/restrictions",
  "/api/v1/currency-management/me/offers",
  "/api/v1/item-management/me/offers/me/search",
  "/api/flexibleOffers/me/search",
  "/api/predefinedOffers/me",
  "/api/predefinedOffers/game",
]);
const tokenSchema = z.object({
  accessToken: z.string().min(1),
  expiresIn: z.number().positive(),
  tokenType: z.string().optional(),
});
const date = z.iso.datetime({ offset: true });
const price = z.object({
  amount: z.number().finite(),
  currency: z.string().regex(/^[A-Z]{3}$/),
});
const offerDetails = z
  .object({
    offerTitle: z.string().nullish(),
    gameCategoryTitle: z.string().nullish(),
    gameId: z.string().nullish(),
    description: z.string().nullish(),
    category: z.string().nullish(),
    deliveryMethod: z.string().nullish(),
    guaranteedDeliveryTime: z.string().nullish(),
  })
  .transform((details) => ({
    ...details,
    // Predefined listings can legitimately have no offerTitle. Derive the
    // label from documented product metadata, never from buyer tracking data.
    offerTitle:
      details.offerTitle?.trim() ||
      [details.gameCategoryTitle, details.category]
        .filter(Boolean)
        .join(" · ") ||
      "Digital product",
  }));
export const upstreamOrder = z.object({
  id: z.guid(),
  buyerId: z.string().nullish(),
  buyerUsername: z
    .string()
    .nullish()
    .transform((value) => value || "Unknown buyer"),
  offerId: z.guid().nullish(),
  purchaseQuantity: z.number().nonnegative(),
  totalPrice: price,
  state: z.object({ state: z.string(), createdDate: date.optional() }),
  stateLogs: z
    .array(z.object({ state: z.string(), createdDate: date }))
    .default([]),
  orderOfferDetails: offerDetails.default({ offerTitle: "Digital product" }),
  createdDate: date,
  deliveryTime: z.string().nullable().optional(),
  talkJsConversationId: z.string().nullable().optional(),
  latestDispute: z
    .object({ reason: z.string().optional(), message: z.string().nullish() })
    .nullable()
    .optional(),
  cancelation: z
    .object({
      reason: z.string().optional(),
      message: z.string().nullish(),
      canceledByUserRole: z.string().optional(),
    })
    .nullable()
    .optional(),
});
export const orderPageSchema = z.object({
  results: z.array(upstreamOrder),
  pageSize: z.number().int().nonnegative().optional(),
  nextPageCursor: z.string().nullable().optional(),
  previousPageCursor: z.string().nullable().optional(),
});
export type UpstreamOrder = z.infer<typeof upstreamOrder>;
export type OrderPage = z.infer<typeof orderPageSchema>;

const availabilityRoutes: Record<
  OfferSource,
  { prefix: string; method: "PUT" | "POST" }
> = {
  flexible: { prefix: "/api/flexibleOffersUser/me/", method: "PUT" },
  predefined: { prefix: "/api/predefinedOffersUser/me/", method: "PUT" },
  items: { prefix: "/api/v1/item-management/me/offers/", method: "POST" },
  currency: { prefix: "/api/v1/currency-management/me/offers/", method: "PUT" },
};

export class EldoradoClient {
  private token: string | undefined;
  private expiresAt = 0;
  private refresh: Promise<string> | undefined;
  private cooldownUntil = 0;

  constructor(
    private credentials: SellerCredentials | (() => Promise<SellerCredentials>),
    private fetcher: typeof fetch = serverFetch,
    private now = Date.now,
    private rateStore?: ProviderRateStore,
  ) {}

  private assertRateLimit() {
    if (this.now() < this.cooldownUntil) {
      throw new AppError(
        "ELDORADO_RATE_LIMITED",
        `Eldorado rate limit reached. Try again in ${Math.ceil((this.cooldownUntil - this.now()) / 1000)} seconds.`,
        429,
        Math.ceil((this.cooldownUntil - this.now()) / 1000),
      );
    }
  }

  private async discard(response: Response) {
    try {
      await response.body?.cancel();
    } catch {
      // Canceling an already-closed body must not hide the original status.
    }
  }

  private async rejectRateLimit(response: Response): Promise<never> {
    const retryAfter = response.headers.get("retry-after");
    const delta =
      retryAfter && /^\d+$/.test(retryAfter)
        ? Number(retryAfter) * 1000
        : retryAfter
          ? Date.parse(retryAfter) - this.now()
          : NaN;
    this.cooldownUntil =
      this.now() + (Number.isFinite(delta) ? Math.max(1000, delta) : 30000);
    try {
      await this.rateStore?.defer(this.cooldownUntil);
    } finally {
      await this.discard(response);
    }
    this.assertRateLimit();
    throw new AppError(
      "ELDORADO_RATE_LIMITED",
      "Eldorado rate limit reached.",
      429,
    );
  }

  private async request(
    url: URL | string,
    options: RequestInit,
  ): Promise<Response> {
    await this.rateStore?.check();
    try {
      const fetcher =
        this.fetcher === serverFetch &&
        options.method === "GET" &&
        options.body === currencyOfferSearchBody
          ? currencyOffersFetch
          : this.fetcher;
      return await fetcher(url, options);
    } catch {
      throw new AppError(
        "ELDORADO_UNREACHABLE",
        "Eldorado could not be reached. Check connectivity and try again.",
        502,
      );
    }
  }

  private async json(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new AppError(
        "UPSTREAM_CONTRACT",
        "Eldorado returned an invalid JSON response.",
        502,
      );
    }
  }

  private async authenticate(): Promise<string> {
    this.assertRateLimit();
    if (this.token && this.now() < this.expiresAt) return this.token;
    if (!this.refresh) {
      this.refresh = (async () => {
        const response = await this.request(
          `${origin}/api/authentication/seller/token`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify(
              typeof this.credentials === "function"
                ? await this.credentials()
                : this.credentials,
            ),
            redirect: "error",
            signal: AbortSignal.timeout(15000),
            cache: "no-store",
          },
        );
        if (response.status === 429) return this.rejectRateLimit(response);
        if (!response.ok) {
          await this.discard(response);
          throw new AppError(
            response.status === 401 || response.status === 403
              ? "ELDORADO_AUTH_REJECTED"
              : "ELDORADO_AUTH_FAILED",
            `Eldorado authentication returned HTTP ${response.status}.`,
            502,
          );
        }
        const parsed = tokenSchema.safeParse(await this.json(response));
        if (!parsed.success) {
          throw new AppError(
            "UPSTREAM_CONTRACT",
            "Unexpected authentication response.",
            502,
          );
        }
        this.token = parsed.data.accessToken;
        this.expiresAt =
          this.now() + Math.max(0, parsed.data.expiresIn - 60) * 1000;
        return this.token;
      })().finally(() => {
        this.refresh = undefined;
      });
    }
    return this.refresh;
  }

  /** Read only an explicitly documented seller route; tokens never leave this class. */
  private async readResponse(
    path: string,
    query?: Record<string, string>,
  ): Promise<Response> {
    if (
      !documentedReads.has(path) &&
      !/^\/api\/predefinedOffers\/[0-9a-f-]{36}\/private$/i.test(path)
    ) {
      throw new AppError(
        "UNDOCUMENTED_ENDPOINT",
        "This seller API route is not an enabled documented read endpoint.",
        400,
      );
    }
    const url = new URL(path, origin);
    for (const [name, value] of Object.entries(query ?? {})) {
      if (
        !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(name) ||
        typeof value !== "string" ||
        value.length > 2000
      ) {
        throw new AppError(
          "INVALID_QUERY",
          "The seller API query is invalid.",
          400,
        );
      }
      url.searchParams.set(name, value);
    }
    const currencySearch = path === "/api/v1/currency-management/me/offers";
    if (currencySearch && url.search)
      throw new AppError(
        "CURRENCY_QUERY_UNVERIFIED",
        "Currency search currently supports only the verified initial-page JSON request.",
        400,
      );
    this.assertRateLimit();
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.authenticate();
      this.assertRateLimit();
      const response = await this.request(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          swagger: "Swager request",
          Accept: "application/json",
          ...(currencySearch ? { "Content-Type": "application/json" } : {}),
        },
        ...(currencySearch ? { body: currencyOfferSearchBody } : {}),
        redirect: "error",
        signal: AbortSignal.timeout(20000),
        cache: "no-store",
      });
      if (response.status === 401 && attempt === 0) {
        await this.discard(response);
        // A late 401 from an older request must not invalidate a newer token.
        if (this.token === token) {
          this.token = undefined;
          this.expiresAt = 0;
        }
        continue;
      }
      if (response.status === 429) return this.rejectRateLimit(response);
      if (!response.ok) {
        await this.discard(response);
        throw new AppError(
          response.status === 401
            ? "ELDORADO_ACCESS_EXPIRED"
            : response.status === 403
              ? "ELDORADO_ACCESS_DENIED"
              : response.status === 404
                ? "ELDORADO_READ_NOT_FOUND"
                : response.status >= 500
                  ? "ELDORADO_SERVICE_UNAVAILABLE"
                  : "ELDORADO_REQUEST_FAILED",
          `Eldorado read returned HTTP ${response.status}.`,
          502,
        );
      }
      return response;
    }
    throw new AppError(
      "ELDORADO_AUTH_FAILED",
      "Eldorado rejected the refreshed token.",
      502,
    );
  }

  async read<T>(
    path: string,
    parser: (data: unknown) => T,
    query?: Record<string, string>,
  ): Promise<T> {
    const data = await this.json(await this.readResponse(path, query));
    try {
      return parser(data);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        "UPSTREAM_CONTRACT",
        "The seller API response does not match the verified contract.",
        502,
      );
    }
  }

  async downloadReport(raw: unknown) {
    const input = reportRequest.parse(raw);
    const path = {
      "sold-orders": "/api/v1/orders/me/sold-order-data",
      orders: "/api/v1/orders/me/order-data",
      invoice: "/api/v1/orders/me/invoice/generate",
    }[input.kind];
    const response = await this.readResponse(path, {
      fromDate: input.from + "T00:00:00.000Z",
      untilDate: input.until + "T23:59:59.999Z",
    });
    const contentType =
      response.headers.get("content-type")?.split(";")[0].toLowerCase() ?? "";
    const reader = response.body?.getReader();
    if (!reader)
      throw new AppError(
        "EMPTY_REPORT",
        "Eldorado returned an empty report.",
        502,
      );
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.byteLength;
        if (length > 10 * 1024 * 1024)
          throw new AppError(
            "REPORT_TOO_LARGE",
            "This report exceeds the 10 MiB application download budget. Select a shorter date range.",
            413,
          );
        chunks.push(next.value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    const bytes = Buffer.concat(chunks);
    if (!bytes.length)
      throw new AppError(
        "EMPTY_REPORT",
        "No report content was returned for this period.",
        404,
      );
    if (["application/csv", "text/csv"].includes(contentType))
      return { bytes, type: "csv" as const };
    if (
      input.kind === "invoice" &&
      contentType === "application/pdf" &&
      bytes.subarray(0, 5).toString() === "%PDF-"
    )
      return { bytes, type: "pdf" as const };
    throw new AppError(
      "REPORT_FORMAT_UNVERIFIED",
      "The provider returned an unverified report format. No file was downloaded.",
      502,
    );
  }

  /** Explicit account/notification action. A timeout is never retried. */
  async writeSellerAction(raw: SellerAction, beforeSend?: () => Promise<void>) {
    const action = sellerAction.parse(raw);
    const path =
      action.kind === "seller.online"
        ? "/api/offerUser/me/switchOnline"
        : action.kind === "seller.offline"
          ? "/api/offerUser/me/switchOffline"
          : action.kind === "notification.read"
            ? `/api/notifications/me/${action.notificationId}/markAsRead`
            : "/api/notifications/me/markAllAsRead";
    let token: string;
    try {
      token = await this.authenticate();
    } catch (error) {
      throw new AppError(
        "ELDORADO_WRITE_NOT_SENT",
        "Authentication is unavailable. No Seller action was sent.",
        error instanceof AppError ? error.status : 503,
        error instanceof AppError ? error.retryAfter : undefined,
      );
    }
    let response: Response;
    if (beforeSend) await beforeSend();
    try {
      response = await this.request(new URL(path, origin), {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          swagger: "Swager request",
          Accept: "application/json",
        },
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(20000),
      });
    } catch (error) {
      if (
        error instanceof AppError &&
        ["ELDORADO_RATE_LIMITED", "RATE_GATE_UNAVAILABLE"].includes(error.code)
      )
        throw new AppError(
          "ELDORADO_WRITE_NOT_SENT",
          error.message,
          error.status,
          error.retryAfter,
        );
      throw new AppError(
        "ELDORADO_WRITE_UNKNOWN",
        "The Seller action outcome is uncertain. It was not retried.",
        502,
      );
    }
    if (response.status === 429) {
      try {
        await this.rejectRateLimit(response);
      } catch {}
    } else await this.discard(response);
    if (!response.ok) {
      if (response.status === 401 && this.token === token) {
        this.token = undefined;
        this.expiresAt = 0;
      }
      throw new AppError(
        response.status >= 400 &&
          response.status < 500 &&
          ![408, 499].includes(response.status)
          ? "ELDORADO_WRITE_REJECTED"
          : "ELDORADO_WRITE_UNKNOWN",
        `Eldorado returned HTTP ${response.status}. No automatic retry was sent.`,
        502,
      );
    }
    return { acknowledged: true as const };
  }

  /** One explicitly confirmed listing action. Never retries a commercial write. */
  async setOfferAvailability(
    source: OfferSource,
    nativeId: string,
    action: "pause" | "resume",
  ): Promise<void> {
    if (
      !Object.hasOwn(availabilityRoutes, source) ||
      !/^[A-Za-z0-9_-]{1,150}$/.test(nativeId) ||
      (action !== "pause" && action !== "resume")
    )
      throw new AppError(
        "INVALID_AVAILABILITY_TARGET",
        "Choose one supported listing and availability action.",
        400,
      );
    let token: string;
    try {
      token = await this.authenticate();
      this.assertRateLimit();
    } catch {
      throw new AppError(
        "ELDORADO_WRITE_NOT_SENT",
        "Eldorado authentication is unavailable. No listing change was sent.",
        502,
      );
    }
    const route = availabilityRoutes[source];
    let response: Response;
    try {
      response = await this.request(
        new URL(route.prefix + nativeId + "/" + action, origin),
        {
          method: route.method,
          headers: {
            Authorization: `Bearer ${token}`,
            swagger: "Swager request",
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          redirect: "error",
          signal: AbortSignal.timeout(20000),
          cache: "no-store",
        },
      );
    } catch (error) {
      if (
        error instanceof AppError &&
        ["ELDORADO_RATE_LIMITED", "RATE_GATE_UNAVAILABLE"].includes(error.code)
      )
        throw new AppError(
          "ELDORADO_WRITE_NOT_SENT",
          error.message,
          error.status,
          error.retryAfter,
        );
      throw new AppError(
        "ELDORADO_WRITE_UNKNOWN",
        "The listing change could not be confirmed. Do not submit it again; check its status.",
        502,
      );
    }
    if (response.ok) {
      await this.discard(response);
      return;
    }
    const status = response.status;
    if (status === 401 && this.token === token) {
      // A later, separately confirmed request may authenticate again. The
      // rejected commercial request itself is never replayed.
      this.token = undefined;
      this.expiresAt = 0;
    }
    if (status === 429) {
      try {
        await this.rejectRateLimit(response);
      } catch {
        // Preserve the shared cooldown while classifying this request as an
        // explicit upstream rejection, rather than an ambiguous retry.
      }
    } else {
      await this.discard(response);
    }
    if (status >= 400 && status < 500 && status !== 408 && status !== 499)
      throw new AppError(
        "ELDORADO_WRITE_REJECTED",
        `Eldorado rejected this listing change (HTTP ${status}).`,
        502,
      );
    throw new AppError(
      "ELDORADO_WRITE_UNKNOWN",
      "Eldorado did not confirm the listing change. Check its status before taking another action.",
      502,
    );
  }

  /** Read only an individual listing's identity/state; discard all private envelope fields. */
  async offerState(
    source: OfferSource,
    nativeId: string,
  ): Promise<{ id: string; state: string }> {
    const id = z.guid().safeParse(nativeId);
    if (!id.success)
      throw new AppError(
        "INVALID_OFFER_ID",
        "Choose a valid marketplace listing identifier.",
        400,
      );
    const path =
      source === "flexible"
        ? `/api/flexibleOffers/${id.data}/private`
        : source === "predefined"
          ? `/api/predefinedOffers/${id.data}/private`
          : source === "currency"
            ? `/api/v1/currency-management/me/offers/${id.data}`
            : undefined;
    if (!path)
      throw new AppError(
        "OFFER_STATE_READ_UNAVAILABLE",
        "An individual state read has not been verified for this listing family.",
        503,
      );
    this.assertRateLimit();
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.authenticate();
      this.assertRateLimit();
      const response = await this.request(new URL(path, origin), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          swagger: "Swager request",
          Accept: "application/json",
        },
        redirect: "error",
        signal: AbortSignal.timeout(20000),
        cache: "no-store",
      });
      if (response.status === 401 && attempt === 0) {
        await this.discard(response);
        if (this.token === token) {
          this.token = undefined;
          this.expiresAt = 0;
        }
        continue;
      }
      if (response.status === 429) return this.rejectRateLimit(response);
      if (!response.ok) {
        await this.discard(response);
        throw new AppError(
          "ELDORADO_REQUEST_FAILED",
          `Eldorado listing read returned HTTP ${response.status}.`,
          502,
        );
      }
      const parsed = z
        .object({
          offer: z.object({
            id: z.guid(),
            offerState: z.string().min(1).max(100),
          }),
        })
        .safeParse(await this.json(response));
      if (
        !parsed.success ||
        parsed.data.offer.id.toLowerCase() !== id.data.toLowerCase()
      )
        throw new AppError(
          "UPSTREAM_CONTRACT",
          "The individual listing response could not verify the requested listing state.",
          502,
        );
      return {
        id: parsed.data.offer.id,
        state: parsed.data.offer.offerState,
      };
    }
    throw new AppError(
      "ELDORADO_AUTH_FAILED",
      "Eldorado rejected the refreshed token.",
      502,
    );
  }

  async predefinedSnapshot(nativeId: string) {
    const id = z.guid().parse(nativeId);
    return this.read(`/api/predefinedOffers/${id}/private`, (data) => {
      const { offer } = z
        .object({
          offer: z.object({
            id: z.guid(),
            offerState: z.string(),
            userId: z.string().optional(),
            pricePerUnit: price,
            pricePerUnitWithDiscount: z.unknown().optional(),
            discountPercentage: z.unknown().optional(),
            quantity: z.number().nonnegative(),
            gameId: z.string(),
            category: z.string(),
            description: z.string().nullish(),
            minQuantity: z.number().optional(),
            volumeDiscounts: z.array(z.json()).optional(),
            guaranteedDeliveryTime: z.string().optional(),
            deliveryMethod: z.string().optional(),
            unitSystem: z.string().optional(),
            attributes: z.array(z.json()).optional(),
            tradeEnvironmentValues: z.array(z.json()).optional(),
            offerAttributeIdValues: z.array(z.json()).optional(),
          }),
        })
        .parse(data);
      if (offer.id.toLowerCase() !== id.toLowerCase())
        throw new AppError(
          "UPSTREAM_CONTRACT",
          "The listing identity did not match.",
          502,
        );
      const detail = predefinedInput.shape.details.safeParse({
        description: offer.description ?? "",
        guaranteedDeliveryTime: offer.guaranteedDeliveryTime,
        pricing: {
          quantity: offer.quantity,
          minQuantity: offer.minQuantity,
          volumeDiscounts: offer.volumeDiscounts,
          pricePerUnit: offer.pricePerUnit,
        },
        deliveryMethod: offer.deliveryMethod,
      });
      const contextComplete =
        [
          offer.attributes,
          offer.tradeEnvironmentValues,
          offer.offerAttributeIdValues,
        ].every(Array.isArray) &&
        typeof offer.minQuantity === "number" &&
        !!offer.unitSystem &&
        !!offer.deliveryMethod;
      const emptyContext =
        contextComplete &&
        [
          offer.attributes,
          offer.tradeEnvironmentValues,
          offer.offerAttributeIdValues,
        ].every((value) => !value?.length);
      const discountedPrice = price.safeParse(offer.pricePerUnitWithDiscount),
        discountPercent = z
          .number()
          .finite()
          .min(0)
          .max(100)
          .safeParse(offer.discountPercentage);
      return {
        id: offer.id,
        sellerId: offer.userId ?? null,
        state: offer.offerState,
        price: offer.pricePerUnit.amount,
        currency: offer.pricePerUnit.currency,
        discount: {
          pricePerUnitWithDiscount: discountedPrice.success
            ? discountedPrice.data
            : null,
          discountPercentage: discountPercent.success
            ? discountPercent.data
            : null,
          unverified:
            (offer.pricePerUnitWithDiscount != null &&
              !discountedPrice.success) ||
            (offer.discountPercentage != null && !discountPercent.success),
        },
        quantity: offer.quantity,
        gameId: offer.gameId,
        category: offer.category,
        details: detail.success ? detail.data : null,
        contextComplete,
        context: {
          attributes: offer.attributes ?? null,
          tradeEnvironmentValues: offer.tradeEnvironmentValues ?? null,
          offerAttributeIdValues: offer.offerAttributeIdValues ?? null,
          unitSystem: offer.unitSystem ?? null,
          deliveryMethod: offer.deliveryMethod ?? null,
          minQuantity: offer.minQuantity ?? null,
        },
        document:
          emptyContext && detail.success
            ? {
                details: detail.data,
                augmentedGame: {
                  gameId: offer.gameId,
                  category: offer.category,
                  tradeEnvironmentId: null,
                  offerAttributes: [],
                },
                giftCardDetails: null,
              }
            : null,
      };
    });
  }

  /** Contracts supplied from the authenticated Swagger. No commercial write is retried. */
  async writeMarketplace(
    rawChange: MarketplaceChange,
    nativeId?: string,
    beforeSend?: () => Promise<void>,
  ): Promise<{
    acknowledged: true;
    createdId?: string;
    order?: { id: string; state: string; deliveryTime: string | null };
  }> {
    const change = marketplaceChange.parse(rawChange);
    const id =
      change.kind === "offer.create" ? undefined : z.guid().parse(nativeId);
    const routes = {
      "offer.price": ["PUT", `/api/predefinedOffersUser/me/${id}/changePrice`],
      "offer.quantity": [
        "PUT",
        `/api/predefinedOffersUser/me/${id}/changeQuantity`,
      ],
      "offer.details": ["PUT", `/api/predefinedOffers/${id}/details`],
      "offer.create": ["POST", "/api/predefinedOffers"],
      "order.deliver": ["PUT", `/api/v1/orders/me/${id}/deliver`],
      "order.cancel": ["POST", `/api/v1/orders/me/${id}/cancel`],
      "order.extend": ["POST", `/api/v1/orders/me/${id}/extend-delivery-time`],
      "order.correct": [
        "POST",
        `/api/v1/orders/me/${id}/delivery-details/correction`,
      ],
    } as const;
    let token: string;
    try {
      token = await this.authenticate();
      this.assertRateLimit();
    } catch {
      throw new AppError(
        "ELDORADO_WRITE_NOT_SENT",
        "Authentication was unavailable. No marketplace change was sent.",
        503,
      );
    }
    if (beforeSend) await beforeSend();
    const [method, path] = routes[change.kind];
    let response: Response;
    try {
      response = await this.request(new URL(path, origin), {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          swagger: "Swager request",
          Accept: "application/json",
          ...("body" in change ? { "Content-Type": "application/json" } : {}),
        },
        ...("body" in change ? { body: JSON.stringify(change.body) } : {}),
        redirect: "error",
        signal: AbortSignal.timeout(20000),
        cache: "no-store",
      });
    } catch (error) {
      if (
        error instanceof AppError &&
        ["ELDORADO_RATE_LIMITED", "RATE_GATE_UNAVAILABLE"].includes(error.code)
      )
        throw new AppError(
          "ELDORADO_WRITE_NOT_SENT",
          error.message,
          error.status,
          error.retryAfter,
        );
      throw new AppError(
        "ELDORADO_WRITE_UNKNOWN",
        "The result is uncertain. Check the recorded operation before taking another action.",
        502,
      );
    }
    if (!response.ok) {
      const status = response.status;
      if (status === 401 && this.token === token) {
        this.token = undefined;
        this.expiresAt = 0;
      }
      if (status === 429) {
        try {
          await this.rejectRateLimit(response);
        } catch {}
      } else await this.discard(response);
      throw new AppError(
        status >= 400 && status < 500 && status !== 408 && status !== 499
          ? "ELDORADO_WRITE_REJECTED"
          : "ELDORADO_WRITE_UNKNOWN",
        `Eldorado returned HTTP ${status}. No automatic retry was sent.`,
        502,
      );
    }
    if (change.kind === "order.deliver") {
      const parsed = upstreamOrder.safeParse(
        await response.json().catch(() => null),
      );
      if (parsed.success && parsed.data.id.toLowerCase() === id!.toLowerCase())
        return {
          acknowledged: true,
          order: {
            id: parsed.data.id,
            state: parsed.data.state.state,
            deliveryTime: parsed.data.deliveryTime ?? null,
          },
        };
    } else if (change.kind === "offer.create") {
      const raw: unknown = await response.json().catch(() => null);
      const candidate =
        typeof raw === "string"
          ? raw
          : raw && typeof raw === "object" && "id" in raw
            ? raw.id
            : undefined;
      const created = z.guid().safeParse(candidate);
      return {
        acknowledged: true,
        ...(created.success ? { createdId: created.data } : {}),
      };
    } else await this.discard(response);
    return { acknowledged: true };
  }

  async orders(
    cursor?: string,
    direction: "Next" | "Previous" = "Next",
  ): Promise<OrderPage> {
    const query: Record<string, string> = {
      displayFilter: "DisplaySellingOrders",
      isAscendingDateOrder: "false",
      pageSize: "50",
    };
    if (cursor) {
      query.cursorValue = cursor;
      query.pageDirection = direction;
    }
    return this.read(
      "/api/v1/orders/me/seller/orders",
      (data) => {
        const parsed = orderPageSchema.safeParse(data);
        if (!parsed.success) {
          throw new AppError(
            "UPSTREAM_CONTRACT",
            "The orders response does not match the documented contract. No records were synchronized.",
            502,
          );
        }
        return parsed.data;
      },
      query,
    );
  }
}
let instance: EldoradoClient | undefined;
export async function eldoradoConfigured() {
  return (await sellerConnectionStatus()).configured;
}
export function resetEldoradoClient() {
  instance = undefined;
}
export function eldoradoClient() {
  return (instance ??= new EldoradoClient(
    resolveSellerCredentials,
    serverFetch,
    Date.now,
    eldoradoRateStore(),
  ));
}
