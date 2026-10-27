import { z } from "zod";
import { AppError } from "@/lib/errors";

export const intents = [
  "general",
  "delivery",
  "account_access",
  "cancellation",
  "dispute",
  "needs_details",
] as const;
export type SupportIntent = (typeof intents)[number];
export type CopilotTask =
  "suggest_reply" | "translate" | "summarize" | "classify";
export type CopilotContext = {
  messages: { speaker: "buyer" | "agent"; text: string }[];
  order?: { state: string; category?: string };
};
export type CopilotInput = {
  task: CopilotTask;
  context: CopilotContext;
  intent?: SupportIntent;
  language: "en-US";
  policy: typeof humanReviewPolicy;
};
export const humanReviewPolicy = {
  humanReviewRequired: true,
  maySendMessages: false,
  mayExecuteOperations: false,
  mayPromiseRefundsOrDelivery: false,
  orderFactsMustComeFromContext: true,
} as const;
export const draftSchema = z
  .object({
    source: z.enum(["template", "ai"]),
    text: z.string().trim().min(1).max(5000),
    intent: z.enum(intents),
    requiresHumanReview: z.literal(true),
    escalate: z.boolean(),
    reason: z.string().max(500).nullable(),
  })
  .strict();
export type CopilotDraft = z.infer<typeof draftSchema>;

/** A provider can return a draft only. Sending and order mutation are outside this contract. */
export interface CopilotProvider {
  readonly kind: "unavailable" | "template" | "external";
  readonly name: string;
  generate(input: CopilotInput): Promise<unknown>;
}
export class UnavailableCopilotProvider implements CopilotProvider {
  readonly kind = "unavailable" as const;
  readonly name = "Not configured";
  async generate(): Promise<never> {
    throw new AppError(
      "COPILOT_NOT_CONFIGURED",
      "AI assistance is not connected. Configure a provider and approve its privacy policy before enabling external processing.",
      503,
    );
  }
}
