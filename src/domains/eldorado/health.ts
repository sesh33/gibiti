import "server-only";
import { z } from "zod";
import { eldoradoClient } from "./client";
import { AppError } from "@/lib/errors";

const integer = z.number().int().nonnegative();
const unread = z.object({ unread: integer, hasMore: z.boolean() });
const reads = [
  {
    name: "notifications",
    path: "/api/notifications/me/unread-count",
    parse: (data: unknown) => unread.parse(data),
  },
  {
    name: "pendingReviews",
    path: "/api/v1/orders/me/pending-review-order-count",
    parse: (data: unknown) => integer.parse(data),
  },
  {
    name: "restrictions",
    path: "/api/offerUser/me/restrictions",
    parse: (data: unknown) => z.array(z.unknown()).parse(data).length,
  },
] as const;
export async function readSellerHealth(client = eldoradoClient()) {
  const results = await Promise.allSettled(
    reads.map(async (read) => {
      const value = await client.read<number | z.infer<typeof unread>>(
        read.path,
        read.parse,
      );
      return { name: read.name, value };
    }),
  );
  return {
    checkedAt: new Date().toISOString(),
    checks: results.map((result, index) =>
      result.status === "fulfilled"
        ? { ok: true as const, ...result.value }
        : {
            ok: false as const,
            name: reads[index].name,
            code:
              result.reason instanceof AppError
                ? result.reason.code
                : "UPSTREAM_CONTRACT",
          },
    ),
  };
}
