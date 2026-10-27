import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/domains/authentication/session";
import { messagingProvider } from "@/domains/messaging/service";
import { requireSameOrigin, readBody } from "@/lib/http";
import { AppError, errorResponse } from "@/lib/errors";
export async function GET(request: Request) {
  try {
    await requireStaff("conversations.read");
    const provider = messagingProvider();
    const id = new URL(request.url).searchParams.get("id");
    if (provider.kind === "official")
      throw new AppError(
        "PROVIDER_NOT_IMPLEMENTED",
        "Official messaging adapter is not installed.",
        503,
      );
    if (id)
      return NextResponse.json({
        provider: provider.kind,
        messages: await provider.messages(id),
      });
    return NextResponse.json(
      {
        provider: provider.kind,
        items: await provider.list(),
        reason:
          provider.kind === "unavailable"
            ? "Awaiting official Eldorado messaging authorization."
            : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
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
        conversationId: z.string().min(1).max(200),
        text: z.string().trim().min(1).max(5000),
      })
      .parse(await readBody(request));
    return NextResponse.json({
      message: await messagingProvider().send(input.conversationId, input.text),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
