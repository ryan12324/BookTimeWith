import { Buffer } from "node:buffer";
import type {
  EmailDeliveryResult,
  EmailTransport,
  OutboundEmail,
} from "./types";

export interface CloudflareEmailTransportConfig {
  accountId: string;
  apiToken: string;
}

interface CloudflareSendResponse {
  success?: boolean;
  errors?: Array<{ code?: number; message?: string }>;
  result?: {
    message_id?: string;
    delivered?: string[];
    queued?: string[];
    permanent_bounces?: string[];
  };
}

const responseError = (data: CloudflareSendResponse, fallback: string) => {
  const detail = data.errors
    ?.map((error) => error.message?.trim())
    .filter(Boolean)
    .join("; ");
  return (detail || fallback).slice(0, 300);
};

/** Direct adapter for Cloudflare Email Service's structured REST API. */
export class CloudflareEmailTransport implements EmailTransport {
  readonly provider = "cloudflare";

  constructor(
    private readonly config: CloudflareEmailTransportConfig,
    private readonly request: typeof fetch = fetch,
  ) {}

  async send(message: OutboundEmail): Promise<EmailDeliveryResult> {
    const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.config.accountId)}/email/sending/send`;
    try {
      const response = await this.request(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: [message.to],
          from: {
            address: message.from.address,
            name: message.from.name,
          },
          ...(message.replyTo ? { reply_to: message.replyTo } : {}),
          subject: message.subject,
          html: message.html,
          ...(message.idempotencyKey
            ? {
                headers: {
                  "X-Book-Time-With-Delivery-Key": message.idempotencyKey,
                },
              }
            : {}),
          ...(message.attachments?.length
            ? {
                attachments: message.attachments.map((attachment) => ({
                  filename: attachment.filename,
                  type: attachment.contentType,
                  disposition: "attachment",
                  content:
                    attachment.contentEncoding === "base64"
                      ? attachment.content
                      : Buffer.from(attachment.content, "utf8").toString(
                          "base64",
                        ),
                })),
              }
            : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      });

      const data = (await response.json().catch(() => ({}))) as CloudflareSendResponse;
      if (!response.ok || data.success !== true) {
        return {
          status: "failed",
          error: `Cloudflare Email returned ${response.status}: ${responseError(data, response.statusText || "request failed")}`,
        };
      }

      // Cloudflare can return a successful API envelope without populating the
      // immediate delivery/queue arrays, even though it has accepted and sends
      // the message. Only an explicit bounce should override `success: true`.
      if ((data.result?.permanent_bounces?.length ?? 0) > 0) {
        return {
          status: "failed",
          error: "Cloudflare Email permanently rejected the recipient",
        };
      }

      return { status: "delivered" };
    } catch (error) {
      return {
        status: "failed",
        error:
          error instanceof Error
            ? `Cloudflare Email request failed: ${error.message}`
            : "Cloudflare Email request failed",
      };
    }
  }
}
