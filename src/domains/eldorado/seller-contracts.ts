import { z } from "zod";
export const sellerAction = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("seller.online") }).strict(),
  z.object({ kind: z.literal("seller.offline") }).strict(),
  z
    .object({
      kind: z.literal("notification.read"),
      notificationId: z.string().regex(/^[A-Za-z0-9_-]{1,150}$/),
    })
    .strict(),
  z.object({ kind: z.literal("notifications.read_all") }).strict(),
]);
export type SellerAction = z.infer<typeof sellerAction>;
export const reportKind = z.enum(["sold-orders", "orders", "invoice"]);
export type ReportKind = z.infer<typeof reportKind>;
export const reportRequest = z
  .object({
    kind: reportKind,
    from: z.iso.date(),
    until: z.iso.date(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const span = Date.parse(value.until) - Date.parse(value.from);
    if (span < 0 || span > 366 * 86400000)
      ctx.addIssue({
        code: "custom",
        message: "Choose an inclusive date range of at most 367 days.",
      });
  });
