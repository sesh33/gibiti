import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OfferEditor } from "../../../src/components/offer-editor";
import { ApprovalsModule } from "../../../src/components/operations-modules";
import { OrderDetail } from "../../../src/components/order-detail";
const query = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});
const component =
  location.pathname === "/approvals" ? (
    <ApprovalsModule configured={true} />
  ) : location.pathname.startsWith("/orders/") ? (
    <OrderDetail id={location.pathname.split("/").at(-1)!} configured={true} />
  ) : (
    <OfferEditor configured={true} />
  );
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={query}>{component}</QueryClientProvider>,
);
