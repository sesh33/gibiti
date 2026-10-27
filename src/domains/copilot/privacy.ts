import type { CopilotContext } from "./provider";

/** Defense in depth. Sensitive delivery/internal notes are never inputs to this boundary. */
export function redactSupportText(text: string): string {
  return text
    .replace(
      /\b(?:authorization\s*:\s*)?bearer\s+[A-Za-z0-9._~+\/-]+/gi,
      "[REDACTED_TOKEN]",
    )
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      "[REDACTED_TOKEN]",
    )
    .replace(
      /\b(?:password|passwd|client[_ -]?secret|api[_ -]?key|access[_ -]?token|recovery[_ -]?code)\s*[:=]\s*[^\s,;]+/gi,
      "[REDACTED_SECRET]",
    )
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, "[REDACTED_IP]")
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      "[REDACTED_ID]",
    )
    .replace(/(?:\+?\d[\d ()-]{8,}\d)/g, "[REDACTED_NUMBER]")
    .slice(0, 4000);
}
export function minimizeCopilotContext(
  context: CopilotContext,
): CopilotContext {
  return {
    messages: context.messages
      .slice(-12)
      .map((message) => ({
        speaker: message.speaker,
        text: redactSupportText(message.text),
      })),
    ...(context.order
      ? {
          order: {
            state: redactSupportText(context.order.state).slice(0, 60),
            ...(context.order.category
              ? {
                  category: redactSupportText(context.order.category).slice(
                    0,
                    80,
                  ),
                }
              : {}),
          },
        }
      : {}),
  };
}
