"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { retryQuery } from "@/lib/api-client";
import { useState } from "react";
export function Providers({ children }: React.PropsWithChildren) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30000,
            retry: retryQuery,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
