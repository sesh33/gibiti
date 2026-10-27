import { it, expect } from "vitest";
import { CopilotService, copilotService } from "@/domains/copilot/service";
import { minimizeCopilotContext } from "@/domains/copilot/privacy";
import {
  filterConversations,
  chronologicalMessages,
  parseInboxView,
} from "@/domains/messaging/inbox-view";
import type { Conversation } from "@/domains/messaging/provider";
it("redacts private fields and bounds support context before any provider receives it", () => {
  const result = minimizeCopilotContext({
    messages: Array.from({ length: 20 }, () => ({
      speaker: "buyer" as const,
      text: "Email fixture@example.test password=synthetic-private-value Bearer synthetic-token",
    })),
  });
  expect(result.messages).toHaveLength(12);
  expect(JSON.stringify(result)).not.toContain("fixture@example.test");
  expect(JSON.stringify(result)).not.toContain("synthetic-private-value");
  expect(JSON.stringify(result)).not.toContain("synthetic-token");
});
it("blocks external assistance before calling the provider without explicit privacy approval", async () => {
  let calls = 0;
  const service = new CopilotService({
    kind: "external",
    name: "Fixture",
    async generate() {
      calls++;
      throw new Error("Unexpected call");
    },
  });
  await expect(service.draft({ messages: [] })).rejects.toThrow(
    "privacy settings",
  );
  expect(calls).toBe(0);
});
it("uses labeled local templates with human review and escalation instead of claiming AI or promising outcomes", async () => {
  const result = await copilotService("template").draft({
    messages: [{ speaker: "buyer", text: "Please cancel and refund my order" }],
  });
  expect(result.source).toBe("template");
  expect(result.requiresHumanReview).toBe(true);
  expect(result.escalate).toBe(true);
  expect(result.text).toContain("does not confirm");
  await expect(
    copilotService("template").draft({ messages: [] }, "translate"),
  ).rejects.toThrow("require an approved external provider");
});
it("fails closed for unconfigured AI rather than invoking an external service", async () => {
  await expect(copilotService("ai").draft({ messages: [] })).rejects.toThrow(
    "not connected",
  );
});
it("filters assigned conversations and status while preserving recent activity order", () => {
  const base: Conversation = {
    id: "a",
    buyer: "Synthetic",
    orderId: "fixture",
    product: "Fixture",
    priority: "normal",
    unread: true,
    assignedTo: "agent",
    updatedAt: "2026-10-27T12:00:00Z",
    status: "open",
  };
  const rows = filterConversations(
    [
      base,
      { ...base, id: "b", updatedAt: "2026-10-27T13:00:00Z" },
      { ...base, id: "c", assignedTo: "another" },
    ],
    parseInboxView(new URLSearchParams("filter=assigned&status=open")),
    "agent",
  );
  expect(rows.map((row) => row.id)).toEqual(["b", "a"]);
  expect(chronologicalMessages([])).toEqual([]);
});
