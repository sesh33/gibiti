import { AppError } from "@/lib/errors";
import { minimizeCopilotContext } from "./privacy";
import {
  draftSchema,
  humanReviewPolicy,
  UnavailableCopilotProvider,
  type CopilotContext,
  type CopilotProvider,
  type CopilotTask,
  type SupportIntent,
} from "./provider";
import { TemplateCopilotProvider } from "./templates";

export class CopilotService {
  constructor(
    private provider: CopilotProvider,
    private options: { externalProcessingApproved: boolean } = {
      externalProcessingApproved: false,
    },
  ) {}
  async draft(
    context: CopilotContext,
    task: CopilotTask = "suggest_reply",
    intent?: SupportIntent,
  ) {
    if (
      this.provider.kind === "external" &&
      !this.options.externalProcessingApproved
    )
      throw new AppError(
        "COPILOT_PRIVACY_APPROVAL_REQUIRED",
        "External AI processing is disabled until privacy settings are explicitly approved.",
        403,
      );
    if (
      this.provider.kind === "template" &&
      task !== "suggest_reply" &&
      task !== "classify"
    )
      throw new AppError(
        "COPILOT_TASK_UNAVAILABLE",
        "Translation and AI summaries require an approved external provider. Local templates cannot perform this task.",
        503,
      );
    const result = draftSchema.safeParse(
      await this.provider.generate({
        task,
        context: minimizeCopilotContext(context),
        intent,
        language: "en-US",
        policy: humanReviewPolicy,
      }),
    );
    if (
      !result.success ||
      (this.provider.kind === "template" &&
        result.data.source !== "template") ||
      (this.provider.kind === "external" && result.data.source !== "ai")
    )
      throw new AppError(
        "COPILOT_RESPONSE_REJECTED",
        "The assistance response did not satisfy the human-review draft contract.",
        502,
      );
    return result.data;
  }
}
const templates = new CopilotService(new TemplateCopilotProvider());
const unavailable = new CopilotService(new UnavailableCopilotProvider());
export function copilotService(mode: "template" | "ai") {
  return mode === "template" ? templates : unavailable;
}
export const copilotCapabilities = {
  aiConnected: false,
  externalDataProcessing: false,
  humanReviewRequired: true,
  templatesAvailable: true,
  translationAvailable: false,
  summariesAvailable: false,
  reason:
    "AI provider and privacy configuration are pending. Local reply templates do not use AI and never send messages.",
} as const;
