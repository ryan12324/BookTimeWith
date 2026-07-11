"use client";

import { RouteError } from "@/components/RouteError";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id="main-content" className="min-h-screen bg-paper px-6 py-12">
      <RouteError error={error} reset={reset} />
    </main>
  );
}
