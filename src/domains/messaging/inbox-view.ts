import type { ChatMessage, Conversation } from "./provider";
export const inboxFilters = ["all", "unread", "priority", "assigned"] as const;
export const inboxStatuses = ["all", "open", "resolved"] as const;
export type InboxFilter = (typeof inboxFilters)[number];
export type InboxStatus = (typeof inboxStatuses)[number];
export type InboxView = {
  search: string;
  filter: InboxFilter;
  status: InboxStatus;
};
export function parseInboxView(
  params: Pick<URLSearchParams, "get">,
): InboxView {
  const filter = params.get("filter"),
    status = params.get("status");
  return {
    search: (params.get("search") ?? "").slice(0, 100),
    filter: inboxFilters.includes(filter as InboxFilter)
      ? (filter as InboxFilter)
      : "all",
    status: inboxStatuses.includes(status as InboxStatus)
      ? (status as InboxStatus)
      : "all",
  };
}
export function filterConversations(
  items: Conversation[],
  view: InboxView,
  userId?: string,
) {
  const query = view.search.toLocaleLowerCase("en-US").trim();
  return items
    .filter(
      (item) =>
        (view.status === "all" || item.status === view.status) &&
        (view.filter === "all" ||
          (view.filter === "unread" && item.unread) ||
          (view.filter === "priority" && item.priority === "high") ||
          (view.filter === "assigned" &&
            Boolean(userId) &&
            item.assignedTo === userId)) &&
        `${item.buyer} ${item.orderId} ${item.product}`
          .toLocaleLowerCase("en-US")
          .includes(query),
    )
    .sort(
      (a, b) =>
        Date.parse(b.updatedAt) - Date.parse(a.updatedAt) ||
        a.id.localeCompare(b.id),
    );
}
export function chronologicalMessages(items: ChatMessage[]) {
  return [...items].sort(
    (a, b) =>
      Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
      a.id.localeCompare(b.id),
  );
}
export function mayHandleInboxShortcut(
  target: EventTarget | null,
  composer: HTMLTextAreaElement | null,
) {
  return target === composer;
}
