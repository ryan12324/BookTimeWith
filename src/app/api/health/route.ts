import { isNotNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import {
  canonicalAppUrl,
  canonicalBookingUrl,
  isHttpUrl,
} from "@/lib/urls";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };

function assertProductionConfiguration() {
  if (process.env.NODE_ENV !== "production") return;
  const issues: string[] = [];
  if ((process.env.AUTH_TOKEN_SECRET?.trim().length ?? 0) < 32) {
    issues.push("AUTH_TOKEN_SECRET must contain at least 32 characters");
  }
  if ((process.env.CRON_SECRET?.trim().length ?? 0) < 32) {
    issues.push("CRON_SECRET must contain at least 32 characters");
  }
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    issues.push("DATABASE_URL is required");
  } else {
    try {
      const parsed = new URL(databaseUrl);
      if (
        parsed.protocol !== "postgres:" &&
        parsed.protocol !== "postgresql:"
      ) {
        issues.push("DATABASE_URL must use postgres:// or postgresql://");
      }
    } catch {
      issues.push("DATABASE_URL must be a valid PostgreSQL URL");
    }
  }
  for (const optionalSecret of [
    "CALENDAR_TOKEN_SECRET",
    "RATE_LIMIT_SECRET",
  ] as const) {
    const value = process.env[optionalSecret]?.trim();
    if (value && value.length < 32) {
      issues.push(`${optionalSecret} must contain at least 32 characters when set`);
    }
  }
  const hasTurnstileSecret = Boolean(process.env.TURNSTILE_SECRET_KEY?.trim());
  const hasTurnstileSiteKey = Boolean(
    process.env.TURNSTILE_SITE_KEY?.trim() ||
      process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim(),
  );
  if (hasTurnstileSecret !== hasTurnstileSiteKey) {
    issues.push("both Turnstile keys must be configured together");
  }
  const pairedCredentials = [
    ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"],
  ] as const;
  for (const [idName, secretName] of pairedCredentials) {
    const hasId = Boolean(process.env[idName]?.trim());
    const hasSecret = Boolean(process.env[secretName]?.trim());
    if (hasId !== hasSecret) issues.push(`${idName} and ${secretName} must be set together`);
  }
  const stripeNames = [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_PRICE_GBP",
    "STRIPE_PRICE_USD",
    "STRIPE_PRICE_EUR",
    "STRIPE_PRICE_AUD",
  ] as const;
  const stripeConfiguredCount = stripeNames.filter((name) =>
    Boolean(process.env[name]?.trim()),
  ).length;
  if (stripeConfiguredCount > 0 && stripeConfiguredCount < stripeNames.length) {
    issues.push("Stripe secret, webhook secret, and every supported price must be set together");
  }
  const emailWebhook = process.env.EMAIL_WEBHOOK_URL?.trim();
  if (!emailWebhook) {
    issues.push("EMAIL_WEBHOOK_URL is required for passwordless production");
  } else if (!isHttpUrl(emailWebhook) || new URL(emailWebhook).protocol !== "https:") {
    issues.push("EMAIL_WEBHOOK_URL must use https in production");
  }
  try {
    const appUrl = new URL(canonicalAppUrl());
    const bookingUrl = new URL(canonicalBookingUrl());
    if (appUrl.protocol !== "https:" || bookingUrl.protocol !== "https:") {
      issues.push("canonical app and booking URLs must use https in production");
    }
  } catch (error) {
    issues.push(
      error instanceof Error ? error.message : "canonical URLs are invalid",
    );
  }
  if (issues.length) {
    throw new Error(`Invalid production configuration: ${issues.join("; ")}`);
  }
}

/**
 * Unauthenticated readiness probe for Docker/Coolify.
 *
 * This intentionally checks the database rather than owner data, so it remains
 * healthy after onboarding and never depends on an owner session cookie.
 */
export async function GET() {
  try {
    assertProductionConfiguration();
    const db = await getDb();
    await db.execute(sql`select 1`);
    if (process.env.NODE_ENV === "production") {
      const [billedOwner, connections] = await Promise.all([
        db.query.owners.findFirst({
          where: isNotNull(schema.owners.stripeCustomerId),
        }),
        db.query.calendarConnections.findMany(),
      ]);
      if (billedOwner) {
        const stripeNames = [
          "STRIPE_SECRET_KEY",
          "STRIPE_WEBHOOK_SECRET",
          "STRIPE_PRICE_GBP",
          "STRIPE_PRICE_USD",
          "STRIPE_PRICE_EUR",
          "STRIPE_PRICE_AUD",
        ] as const;
        if (stripeNames.some((name) => !process.env[name]?.trim())) {
          throw new Error(
            "Stripe configuration is required while billing customers exist",
          );
        }
      }
      for (const provider of new Set(
        connections.map((connection) => connection.provider),
      )) {
        const configured =
          provider === "google"
            ? process.env.GOOGLE_CLIENT_ID?.trim() &&
              process.env.GOOGLE_CLIENT_SECRET?.trim()
            : provider === "outlook"
              ? process.env.MICROSOFT_CLIENT_ID?.trim() &&
                process.env.MICROSOFT_CLIENT_SECRET?.trim()
              : false;
        if (!configured) {
          throw new Error(
            `${provider} credentials are required while connections exist`,
          );
        }
      }
    }
    return NextResponse.json({ status: "ok" }, { headers });
  } catch (error) {
    console.error("Health check failed", error);
    return NextResponse.json({ status: "error" }, { status: 503, headers });
  }
}
