import "server-only";
import { validateQuoteBeforeWrite } from "@/domains/pricing/quotes";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { AppError } from "@/lib/errors";

/** Carries measured market freshness across claim and OAuth latency. */
export function pricingValidation(
  operationId: string,
  quoteId: string | null | undefined,
  admin = supabaseAdmin(),
  validate = validateQuoteBeforeWrite,
) {
  let assertFresh: (() => void) | undefined;
  return {
    async verify() {
      if (!quoteId) return;
      const checked = await validate(quoteId);
      const { error } = await admin.rpc("record_repricing_validation", {
        operation_id: operationId,
        quote_id: quoteId,
        evidence: checked.proof,
      });
      if (error)
        throw new AppError(
          "QUOTE_AUDIT_FAILED",
          "Fresh market evidence could not be recorded. No price change was sent.",
          409,
        );
      checked.assertFresh();
      assertFresh = checked.assertFresh;
    },
    beforeSend() {
      if (!quoteId) return;
      try {
        if (!assertFresh) throw new Error("Missing market validation");
        assertFresh();
      } catch {
        throw new AppError(
          "ELDORADO_WRITE_NOT_SENT",
          "Market evidence expired before sending. Simulate and review a new price; no change was sent.",
          409,
        );
      }
    },
  };
}
