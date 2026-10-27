import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { serverFetch } from "@/lib/server-fetch";

// The apex host redirects POST to www. Use the canonical, explicitly authorized
// origin directly so credentials are never replayed through an arbitrary redirect.
const origin = "https://www.eldorado.gg";
const documentedReads = new Set([
  "/api/v1/orders/me/seller/orders",
  "/api/v1/orders/me/seller-api-eligibility",
  "/api/v1/currency-management/me/offers",
  "/api/v1/item-management/me/offers/me/search",
  "/api/flexibleOffers/me/search",
  "/api/predefinedOffers/me",
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
    .object({ reason: z.string().optional(), message: z.string().optional() })
    .nullable()
    .optional(),
  cancelation: z
    .object({
      reason: z.string().optional(),
      message: z.string().optional(),
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

export class EldoradoClient {
  private token: string | undefined;
  private expiresAt = 0;
  private refresh: Promise<string> | undefined;
  private cooldownUntil = 0;

  constructor(
    private credentials: { clientId: string; clientSecret: string },
    private fetcher: typeof fetch = serverFetch,
    private now = Date.now,
    private pagination?: { cursorParameter: string },
  ) {}

  private assertRateLimit() {
    if (this.now() < this.cooldownUntil) {
      throw new AppError(
        "ELDORADO_RATE_LIMITED",
        `Eldorado rate limit reached. Try again in ${Math.ceil((this.cooldownUntil - this.now()) / 1000)} seconds.`,
        429,
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
      this.now() +
      (Number.isFinite(delta)
        ? Math.max(1000, Math.min(delta, 900000))
        : 30000);
    await this.discard(response);
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
    try {
      return await this.fetcher(url, options);
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
            body: JSON.stringify(this.credentials),
            redirect: "error",
            signal: AbortSignal.timeout(15000),
            cache: "no-store",
          },
        );
        if (response.status === 429) return this.rejectRateLimit(response);
        if (!response.ok) {
          await this.discard(response);
          throw new AppError(
            "ELDORADO_AUTH_FAILED",
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
  async read<T>(
    path: string,
    parser: (data: unknown) => T,
    query?: Record<string, string>,
  ): Promise<T> {
    if (!documentedReads.has(path)) {
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
    this.assertRateLimit();
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.authenticate();
      this.assertRateLimit();
      const response = await this.request(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
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
          "ELDORADO_REQUEST_FAILED",
          `Eldorado read returned HTTP ${response.status}.`,
          502,
        );
      }
      const data = await this.json(response);
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
    throw new AppError(
      "ELDORADO_AUTH_FAILED",
      "Eldorado rejected the refreshed token.",
      502,
    );
  }

  async orders(cursor?: string): Promise<OrderPage> {
    const query: Record<string, string> = {};
    if (cursor) {
      if (
        !this.pagination ||
        !/^[-a-zA-Z0-9_]{1,40}$/.test(this.pagination.cursorParameter)
      ) {
        throw new AppError(
          "PAGINATION_CONTRACT_REQUIRED",
          "Verify the official cursor query parameter and configure ELDORADO_CURSOR_PARAMETER before requesting subsequent API pages.",
          503,
        );
      }
      query[this.pagination.cursorParameter] = cursor;
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
export function eldoradoConfigured() {
  return Boolean(
    process.env.ELDORADO_CLIENT_ID && process.env.ELDORADO_CLIENT_SECRET,
  );
}
export function eldoradoClient() {
  if (!eldoradoConfigured()) {
    throw new AppError(
      "INTEGRATION_NOT_CONFIGURED",
      "Configure the Eldorado client credentials in secure environment settings.",
      503,
    );
  }
  return (instance ??= new EldoradoClient(
    {
      clientId: process.env.ELDORADO_CLIENT_ID!,
      clientSecret: process.env.ELDORADO_CLIENT_SECRET!,
    },
    serverFetch,
    Date.now,
    process.env.ELDORADO_CURSOR_PARAMETER
      ? { cursorParameter: process.env.ELDORADO_CURSOR_PARAMETER }
      : undefined,
  ));
}
