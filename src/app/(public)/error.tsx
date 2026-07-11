"use client";

import { RouteError } from "@/components/RouteError";

export default function PublicPageError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="px-6 pb-12">
      <RouteError
        error={error}
        reset={reset}
        title="This booking page hit a problem."
        message="This screen could not verify whether your last booking action finished. Load it again before repeating the change."
      />
    </div>
  );
}
