"use client";

import { RouteError } from "@/components/RouteError";

export default function OwnerAppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      error={error}
      reset={reset}
      title="The owner app hit a problem."
      message="Your last change may not have saved. Try again, then check the saved status before leaving the page."
      homeHref="/app/bookings"
      homeLabel="Return to bookings"
    />
  );
}
