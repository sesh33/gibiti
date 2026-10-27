"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="standalone">
      <h1>Something interrupted your workspace.</h1>
      <p>No operation has been retried automatically.</p>
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
