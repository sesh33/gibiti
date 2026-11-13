import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EldoradoConnection } from "../../../src/components/eldorado-connection";
const query = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});
declare global {
  interface Window {
    connectionCache: () => string;
  }
}
window.connectionCache = () =>
  JSON.stringify({
    queries: query
      .getQueryCache()
      .getAll()
      .map((item) => item.state.data),
    mutations: query
      .getMutationCache()
      .getAll()
      .map((item) => item.state),
  });
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={query}>
    <EldoradoConnection configured={true} />
  </QueryClientProvider>,
);
