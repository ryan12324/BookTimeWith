"use client";

import { RouteError } from "@/components/RouteError";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="bg-paper font-sans text-ink">
        <main id="main-content" className="min-h-screen px-6 py-12">
          <RouteError error={error} reset={reset} />
        </main>
      </body>
    </html>
  );
}
