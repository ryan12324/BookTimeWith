import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import { CloudflareEmailTransport } from "../src/emails/transports/cloudflare";
import {
  createEmailTransport,
  emailTransportConfiguration,
  isEmailTransportConfigured,
} from "../src/emails/transports/factory";

const environment = {
  EMAIL_TRANSPORT: "cloudflare",
  CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
  CLOUDFLARE_EMAIL_API_TOKEN: "api-token",
  EMAIL_FROM_DOMAIN: "booking.booktimewith.com",
};

const message = {
  to: "client@example.com",
  from: {
    address: "no-reply@booking.booktimewith.com",
    name: "Dana via booktimewith.com",
  },
  replyTo: "dana@example.com",
  subject: "Booking confirmed",
  html: "<p>Confirmed</p>",
  idempotencyKey: "confirm:booking-123",
  attachments: [
    {
      filename: "booking.ics",
      contentType: "text/calendar",
      content: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n",
    },
  ],
};

describe("email transport factory", () => {
  it("keeps provider selection and required configuration in one factory", () => {
    expect(emailTransportConfiguration({ ...environment })).toEqual({
      configured: true,
      provider: "cloudflare",
    });
    expect(isEmailTransportConfigured({ ...environment })).toBe(true);
    expect(createEmailTransport({ ...environment })).toBeInstanceOf(
      CloudflareEmailTransport,
    );
  });

  it("reports absent, unsupported, and partial transports without constructing one", () => {
    expect(emailTransportConfiguration({})).toEqual({
      configured: false,
      error: "EMAIL_TRANSPORT is not configured",
    });
    expect(
      emailTransportConfiguration({
        ...environment,
        EMAIL_TRANSPORT: "smtp",
      }),
    ).toEqual({
      configured: false,
      error: "EMAIL_TRANSPORT has unsupported provider: smtp",
    });
    const partial = {
      ...environment,
      CLOUDFLARE_ACCOUNT_ID: "",
      EMAIL_FROM_DOMAIN: "",
    };
    expect(emailTransportConfiguration(partial)).toEqual({
      configured: false,
      error:
        "Cloudflare email transport is missing CLOUDFLARE_ACCOUNT_ID, EMAIL_FROM_DOMAIN",
    });
    expect(createEmailTransport(partial)).toBeNull();
    expect(
      emailTransportConfiguration({
        ...environment,
        CLOUDFLARE_ACCOUNT_ID: "account-123",
      }),
    ).toEqual({
      configured: false,
      error: "CLOUDFLARE_ACCOUNT_ID must be a 32-character hexadecimal ID",
    });
  });
});

describe("Cloudflare Email Service adapter", () => {
  it("maps the provider-neutral message to Cloudflare's REST contract", async () => {
    const request = vi.fn().mockResolvedValue(
      Response.json({
        success: true,
        result: {
          message_id: "message-123",
          delivered: [],
          // Cloudflare is allowed to normalize the echoed address. The request
          // contains one recipient, so a non-empty queue is authoritative.
          queued: [message.to.toUpperCase()],
          permanent_bounces: [],
        },
      }),
    );
    const transport = new CloudflareEmailTransport(
      { accountId: "account/123", apiToken: "api-token" },
      request,
    );

    await expect(transport.send(message)).resolves.toEqual({
      status: "delivered",
    });
    expect(request).toHaveBeenCalledOnce();
    const [url, init] = request.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/account%2F123/email/sending/send",
    );
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      Authorization: "Bearer api-token",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init.body as string)).toEqual({
      to: ["client@example.com"],
      from: {
        address: "no-reply@booking.booktimewith.com",
        name: "Dana via booktimewith.com",
      },
      reply_to: "dana@example.com",
      subject: "Booking confirmed",
      html: "<p>Confirmed</p>",
      headers: {
        "X-Book-Time-With-Delivery-Key": "confirm:booking-123",
      },
      attachments: [
        {
          filename: "booking.ics",
          type: "text/calendar",
          disposition: "attachment",
          content: Buffer.from(
            "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n",
            "utf8",
          ).toString("base64"),
        },
      ],
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("preserves attachments that are already base64 encoded", async () => {
    const request = vi.fn().mockResolvedValue(
      Response.json({
        success: true,
        result: {
          message_id: "message-123",
          delivered: [message.to],
          queued: [],
          permanent_bounces: [],
        },
      }),
    );
    const transport = new CloudflareEmailTransport(
      { accountId: "account-123", apiToken: "api-token" },
      request,
    );
    await transport.send({
      ...message,
      attachments: [
        {
          filename: "image.png",
          contentType: "image/png",
          content: "YWxyZWFkeS1lbmNvZGVk",
          contentEncoding: "base64",
        },
      ],
    });

    const body = JSON.parse(request.mock.calls[0]?.[1]?.body as string);
    expect(body.attachments[0].content).toBe("YWxyZWFkeS1lbmNvZGVk");
  });

  it("returns actionable failures for API errors, permanent bounces, and malformed success", async () => {
    const responses = [
      new Response(
        JSON.stringify({
          success: false,
          errors: [{ code: 1001, message: "Token cannot send email" }],
        }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      ),
      Response.json({
        success: true,
        result: {
          message_id: "message-123",
          delivered: [],
          queued: [],
          permanent_bounces: [message.to],
        },
      }),
      Response.json({ success: true, result: { delivered: [message.to] } }),
    ];
    const request = vi.fn();
    for (const response of responses) request.mockResolvedValueOnce(response);
    const transport = new CloudflareEmailTransport(
      { accountId: "account-123", apiToken: "api-token" },
      request,
    );

    await expect(transport.send(message)).resolves.toEqual({
      status: "failed",
      error: "Cloudflare Email returned 403: Token cannot send email",
    });
    await expect(transport.send(message)).resolves.toEqual({
      status: "failed",
      error: "Cloudflare Email permanently rejected the recipient",
    });
    await expect(transport.send(message)).resolves.toEqual({
      status: "failed",
      error: "Cloudflare Email returned success without accepting the recipient",
    });
  });

  it("turns network failures into retryable transport results", async () => {
    const request = vi.fn().mockRejectedValue(new Error("connection reset"));
    const transport = new CloudflareEmailTransport(
      { accountId: "account-123", apiToken: "api-token" },
      request,
    );

    await expect(transport.send(message)).resolves.toEqual({
      status: "failed",
      error: "Cloudflare Email request failed: connection reset",
    });
  });
});
