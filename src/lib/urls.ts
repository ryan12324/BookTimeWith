const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function configuredOrigin(
  configured: string | undefined,
  productionFallback: string,
  requestUrl?: string,
): string {
  const value = configured?.trim();
  if (value) {
    const parsed = new URL(value);
    if (!isHttpUrl(parsed.href)) {
      throw new Error("Canonical URL must use http or https");
    }
    if (
      process.env.NODE_ENV === "production" &&
      parsed.protocol !== "https:"
    ) {
      throw new Error("Canonical production URL must use https");
    }
    return parsed.origin;
  }

  // Local development keeps its actual port. Every non-loopback request uses a
  // fixed product origin, so an untrusted Host/X-Forwarded-Host cannot poison an
  // emailed link, OAuth redirect URI, or Stripe return URL.
  if (requestUrl) {
    const request = new URL(requestUrl);
    if (
      process.env.NODE_ENV !== "production" &&
      LOOPBACK_HOSTS.has(request.hostname)
    ) {
      return request.origin;
    }
  }
  return productionFallback;
}

export function canonicalAppUrl(requestUrl?: string): string {
  return configuredOrigin(
    process.env.APP_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL,
    "https://booktimewith.com",
    requestUrl,
  );
}

export function canonicalBookingUrl(requestUrl?: string): string {
  return configuredOrigin(
    process.env.BOOKING_URL?.trim() || process.env.NEXT_PUBLIC_BOOKING_URL,
    "https://booktimewith.link",
    requestUrl,
  );
}

export function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
