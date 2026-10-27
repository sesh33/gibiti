import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/errors";
const tokenSchema = z.object({
  accessToken: z.string().min(1),
  expiresIn: z.number().positive(),
  tokenType: z.string().optional(),
});
const price = z.object({
  amount: z.number().finite(),
  currency: z.string().regex(/^[A-Z]{3}$/),
});
export const upstreamOrder = z.object({
  id: z.uuid(),
  buyerId: z.string().optional(),
  buyerUsername: z.string().default("Unknown buyer"),
  offerId: z.uuid().optional(),
  purchaseQuantity: z.number().nonnegative(),
  totalPrice: price,
  state: z.object({
    state: z.string(),
    createdDate: z.iso.datetime().optional(),
  }),
  stateLogs: z
    .array(z.object({ state: z.string(), createdDate: z.iso.datetime() }))
    .default([]),
  orderOfferDetails: z
    .object({
      offerTitle: z.string().default("Untitled product"),
      gameId: z.string().optional(),
      description: z.string().optional(),
      category: z.string().optional(),
      deliveryMethod: z.string().optional(),
    })
    .default({ offerTitle: "Untitled product" }),
  createdDate: z.iso.datetime(),
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
  nextPageCursor: z.string().nullable().optional(),
  previousPageCursor: z.string().nullable().optional(),
});
export type UpstreamOrder = z.infer<typeof upstreamOrder>;
export type OrderPage = z.infer<typeof orderPageSchema>;
export class EldoradoClient {
  private token: string | undefined;
  private expiresAt = 0;
  private refresh: Promise<string> | undefined;
  constructor(
    private credentials: { clientId: string; clientSecret: string },
    private fetcher: typeof fetch = fetch,
    private now = Date.now,
    private pagination?: { cursorParameter: string },
  ) {}
  private async authenticate(): Promise<string> {
    if (this.token && this.now() < this.expiresAt) return this.token;
    if (!this.refresh)
      this.refresh = (async () => {
        const response = await this.fetcher(
          "https://eldorado.gg/api/authentication/seller/token",
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
        if (!response.ok)
          throw new AppError(
            "ELDORADO_AUTH_FAILED",
            `Eldorado authentication returned HTTP ${response.status}.`,
            502,
          );
        const parsed = tokenSchema.safeParse(await response.json());
        if (!parsed.success)
          throw new AppError(
            "UPSTREAM_CONTRACT",
            "Unexpected authentication response.",
            502,
          );
        this.token = parsed.data.accessToken;
        this.expiresAt =
          this.now() + Math.max(0, parsed.data.expiresIn - 60) * 1000;
        return this.token;
      })().finally(() => {
        this.refresh = undefined;
      });
    return this.refresh;
  }
  async orders(cursor?: string): Promise<OrderPage> {
    const url = new URL("https://eldorado.gg/api/v1/orders/me/seller/orders");
    // Cursor parameter must be verified against the account's current Seller API contract before live use.
    if (cursor) {
      if (
        !this.pagination ||
        !/^[-a-zA-Z0-9_]{1,40}$/.test(this.pagination.cursorParameter)
      )
        throw new AppError(
          "PAGINATION_CONTRACT_REQUIRED",
          "Verify the official cursor query parameter and configure ELDORADO_CURSOR_PARAMETER before requesting subsequent API pages.",
          503,
        );
      url.searchParams.set(this.pagination.cursorParameter, cursor);
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.authenticate();
      const response = await this.fetcher(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        redirect: "error",
        signal: AbortSignal.timeout(20000),
        cache: "no-store",
      });
      if (response.status === 401 && attempt === 0) {
        this.token = undefined;
        this.expiresAt = 0;
        continue;
      }
      if (!response.ok)
        throw new AppError(
          "ELDORADO_REQUEST_FAILED",
          `Eldorado orders returned HTTP ${response.status}.`,
          response.status === 429 ? 429 : 502,
        );
      const parsed = orderPageSchema.safeParse(await response.json());
      if (!parsed.success)
        throw new AppError(
          "UPSTREAM_CONTRACT",
          "The orders response does not match the documented contract. No records were synchronized.",
          502,
        );
      return parsed.data;
    }
    throw new AppError(
      "ELDORADO_AUTH_FAILED",
      "Eldorado rejected the refreshed token.",
      502,
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
  if (!eldoradoConfigured())
    throw new AppError(
      "INTEGRATION_NOT_CONFIGURED",
      "Configure the Eldorado client credentials in secure environment settings.",
      503,
    );
  return (instance ??= new EldoradoClient(
    {
      clientId: process.env.ELDORADO_CLIENT_ID!,
      clientSecret: process.env.ELDORADO_CLIENT_SECRET!,
    },
    fetch,
    Date.now,
    process.env.ELDORADO_CURSOR_PARAMETER
      ? { cursorParameter: process.env.ELDORADO_CURSOR_PARAMETER }
      : undefined,
  ));
}
