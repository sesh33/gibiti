import type { MessagingProvider, Conversation, ChatMessage } from "./provider";
import { developmentMocksEnabled } from "./provider";
import { AppError } from "@/lib/errors";
export class MockMessagingProvider implements MessagingProvider {
  readonly kind = "mock" as const;
  private history = new Map<string, ChatMessage[]>();
  private assertDevelopment() {
    if (!developmentMocksEnabled())
      throw new AppError(
        "MOCKS_DISABLED",
        "Mock messaging is development-only.",
        403,
      );
  }
  async list(): Promise<Conversation[]> {
    this.assertDevelopment();
    return [
      {
        id: "dev-conversation",
        buyer: "Sample buyer",
        orderId: "DEV-001",
        product: "Pokémon GO · Development fixture",
        priority: "normal",
        unread: true,
        assignedTo: null,
        updatedAt: "2026-10-27T10:00:00Z",
        status: "open",
      },
    ];
  }
  async messages(id: string) {
    this.assertDevelopment();
    if (id !== "dev-conversation")
      throw new AppError("NOT_FOUND", "Conversation not found.", 404);
    return (
      this.history.get(id) ?? [
        {
          id: "dev-message",
          conversationId: id,
          sender: "buyer" as const,
          text: "This is a synthetic development message. It was not received from Eldorado.",
          createdAt: "2026-10-27T10:00:00Z",
          delivery: "sent" as const,
          attachments: [],
        },
      ]
    );
  }
  async send(id: string, text: string) {
    const history = await this.messages(id);
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      conversationId: id,
      sender: "agent",
      text,
      createdAt: new Date().toISOString(),
      delivery: "sent",
      attachments: [],
    };
    this.history.set(id, [...history, message]);
    return message;
  }
}
