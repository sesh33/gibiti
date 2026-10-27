import type {
  CopilotDraft,
  CopilotInput,
  CopilotProvider,
  SupportIntent,
} from "./provider";

export const replyTemplates: {
  id: SupportIntent;
  name: string;
  text: string;
  escalate: boolean;
}[] = [
  {
    id: "general",
    name: "Welcome",
    text: "Hi! Thanks for reaching out. How can I help you with your order today?",
    escalate: false,
  },
  {
    id: "delivery",
    name: "Checking delivery",
    text: "Thanks for your patience. I'm reviewing the delivery details for your order and will share an update once I have confirmed information.",
    escalate: false,
  },
  {
    id: "account_access",
    name: "Account access help",
    text: "Thanks for letting us know. Please describe the error you are seeing without sharing passwords, recovery codes, or payment details so we can review the issue safely.",
    escalate: true,
  },
  {
    id: "cancellation",
    name: "Cancellation review",
    text: "I understand you would like to discuss cancellation. I will refer your request for review under the applicable order conditions. This message does not confirm a cancellation or refund.",
    escalate: true,
  },
  {
    id: "dispute",
    name: "Supervisor review",
    text: "Thank you for explaining the issue. I'm referring this conversation for supervisor review. Please keep any relevant evidence available and avoid sharing sensitive account information.",
    escalate: true,
  },
  {
    id: "needs_details",
    name: "Request more details",
    text: "Could you share a few more details so I can assist you accurately? Please do not send passwords or payment information.",
    escalate: false,
  },
];
/** Local keyword routing, deliberately described as a template rule rather than AI. */
export function classifyTemplateIntent(text: string): SupportIntent {
  if (/\b(dispute|fraud|scam|chargeback|report)\b/i.test(text))
    return "dispute";
  if (/\b(cancel|cancellation|refund)\b/i.test(text)) return "cancellation";
  if (/\b(password|login|log in|account access|locked|recovery)\b/i.test(text))
    return "account_access";
  if (/\b(delivery|deliver|waiting|receive|received|when|eta)\b/i.test(text))
    return "delivery";
  return "general";
}
export class TemplateCopilotProvider implements CopilotProvider {
  readonly kind = "template" as const;
  readonly name = "Local reply templates";
  async generate(input: CopilotInput): Promise<CopilotDraft> {
    const latestBuyer =
      input.context.messages
        .filter((message) => message.speaker === "buyer")
        .at(-1)?.text ?? "";
    const intent = input.intent ?? classifyTemplateIntent(latestBuyer);
    const template = replyTemplates.find((item) => item.id === intent)!;
    return {
      source: "template",
      text: template.text,
      intent,
      requiresHumanReview: true,
      escalate: template.escalate,
      reason:
        "Selected by a local template rule. No external AI service was called. Review the draft before sending.",
    };
  }
}
