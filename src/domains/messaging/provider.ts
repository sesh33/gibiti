import { AppError } from "@/lib/errors";
export type ChatMessage = {
  id: string;
  conversationId: string;
  sender: "buyer" | "agent";
  text: string;
  createdAt: string;
  delivery: "sent" | "pending" | "failed";
  attachments: { name: string; url: string; type: string }[];
};
export type Conversation = {
  id: string;
  buyer: string;
  orderId: string;
  product: string;
  priority: "normal" | "high";
  unread: boolean;
  assignedTo: string | null;
  updatedAt: string;
  status: "open" | "resolved";
};
export interface MessagingProvider {
  readonly kind: "unavailable" | "mock" | "official";
  list(): Promise<Conversation[]>;
  messages(id: string): Promise<ChatMessage[]>;
  send(id: string, text: string): Promise<ChatMessage>;
}
export class UnavailableMessagingProvider implements MessagingProvider {
  readonly kind = "unavailable" as const;
  async list(): Promise<Conversation[]> {
    return [];
  }
  async messages(): Promise<ChatMessage[]> {
    throw new AppError(
      "MESSAGING_UNAVAILABLE",
      "Official Eldorado messaging access has not been provided.",
      503,
    );
  }
  async send(): Promise<ChatMessage> {
    throw new AppError(
      "MESSAGING_UNAVAILABLE",
      "Sending is disabled until an authorized messaging integration is connected.",
      503,
    );
  }
}
export function developmentMocksEnabled() {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.RIVOX_DEV_MOCKS === "true"
  );
}
