"use client";

import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  if (process.env.NODE_ENV === "development") {
    console.error(error);
  }

  return (
    <Container className="flex flex-1 flex-col items-start justify-center gap-4 py-24">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="text-foreground/70">
        An unexpected error occurred. You can try again.
      </p>
      <Button onClick={() => retry()}>Try again</Button>
    </Container>
  );
}
