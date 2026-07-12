import { CloudflareEmailTransport } from "./cloudflare";
import type { EmailTransport } from "./types";

export type EmailTransportEnvironment = Record<string, string | undefined>;

export type EmailTransportConfiguration =
  | { configured: true; provider: "cloudflare" }
  | { configured: false; error: string };

export function emailTransportConfiguration(
  env: EmailTransportEnvironment = process.env,
): EmailTransportConfiguration {
  const provider = env.EMAIL_TRANSPORT?.trim().toLowerCase();
  if (!provider) {
    return { configured: false, error: "EMAIL_TRANSPORT is not configured" };
  }
  if (provider !== "cloudflare") {
    return {
      configured: false,
      error: `EMAIL_TRANSPORT has unsupported provider: ${provider}`,
    };
  }

  const missing = [
    ["CLOUDFLARE_ACCOUNT_ID", env.CLOUDFLARE_ACCOUNT_ID],
    ["CLOUDFLARE_EMAIL_API_TOKEN", env.CLOUDFLARE_EMAIL_API_TOKEN],
    ["EMAIL_FROM_DOMAIN", env.EMAIL_FROM_DOMAIN],
  ]
    .filter(([, value]) => !value?.trim())
    .map(([name]) => name);
  if (missing.length) {
    return {
      configured: false,
      error: `Cloudflare email transport is missing ${missing.join(", ")}`,
    };
  }
  if (!/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID!.trim())) {
    return {
      configured: false,
      error: "CLOUDFLARE_ACCOUNT_ID must be a 32-character hexadecimal ID",
    };
  }
  return { configured: true, provider: "cloudflare" };
}

export const isEmailTransportConfigured = (
  env: EmailTransportEnvironment = process.env,
) => emailTransportConfiguration(env).configured;

/** Factory is the only place that selects a concrete email provider. */
export function createEmailTransport(
  env: EmailTransportEnvironment = process.env,
): EmailTransport | null {
  const configuration = emailTransportConfiguration(env);
  if (!configuration.configured) return null;

  switch (configuration.provider) {
    case "cloudflare":
      return new CloudflareEmailTransport({
        accountId: env.CLOUDFLARE_ACCOUNT_ID!.trim(),
        apiToken: env.CLOUDFLARE_EMAIL_API_TOKEN!.trim(),
      });
  }
}
