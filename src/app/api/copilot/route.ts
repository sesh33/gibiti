import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/domains/authentication/session";
import { copilotCapabilities, copilotService } from "@/domains/copilot/service";
import { intents } from "@/domains/copilot/provider";
import { messagingProvider } from "@/domains/messaging/service";
import { requireSameOrigin, readBody } from "@/lib/http";
import { AppError, errorResponse } from "@/lib/errors";

export async function GET() {
  try {
    await requireStaff("conversations.read");
    return NextResponse.json(copilotCapabilities, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await requireStaff("conversations.reply");
    const input = z
      .object({
        mode: z.enum(["template", "ai"]).default("template"),
        task: z
          .enum(["suggest_reply", "translate", "summarize", "classify"])
          .default("suggest_reply"),
        conversationId: z.string().min(1).max(200),
        intent: z.enum(intents).optional(),
      })
      .strict()
      .parse(await readBody(request));
    // Unconfigured AI is rejected before fetching or processing customer context.
    if (input.mode === "ai")
      return NextResponse.json(
        await copilotService("ai").draft({ messages: [] }, input.task),
        { headers: { "Cache-Control": "no-store" } },
      );
    const provider = messagingProvider();
    const conversation = (await provider.list()).find(
      (item) => item.id === input.conversationId,
    );
    if (!conversation)
      throw new AppError(
        "CONVERSATION_UNAVAILABLE",
        "Conversation not found or not authorized.",
        404,
      );
    const messages = (await provider.messages(conversation.id)).sort(
      (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
    );
    const draft = await copilotService(input.mode).draft(
      {
        messages: messages.map((item) => ({
          speaker: item.sender,
          text: item.text,
        })),
      },
      input.task,
      input.intent,
    );
    return NextResponse.json(
      { draft, provider: "local-templates", sent: false },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
