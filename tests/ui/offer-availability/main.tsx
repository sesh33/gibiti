import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OffersCenter } from "../../../src/components/offers-center";

const query = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={query}>
    <OffersCenter configured={true} />
  </QueryClientProvider>,
);
