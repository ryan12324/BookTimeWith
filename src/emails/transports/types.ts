export type EmailDeliveryResult =
  | { status: "delivered" }
  | { status: "failed"; error: string };

export interface EmailAttachment {
  filename: string;
  contentType: string;
  content: string;
  /** Existing outbox rows and generated calendar invites contain UTF-8 text. */
  contentEncoding?: "utf8" | "base64";
}

export interface OutboundEmail {
  to: string;
  from: {
    address: string;
    name: string;
  };
  replyTo?: string;
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
  /** Provider-visible correlation key; the durable outbox owns deduplication. */
  idempotencyKey?: string;
}

/** Provider adapter boundary. New transports implement only this contract. */
export interface EmailTransport {
  readonly provider: string;
  send(message: OutboundEmail): Promise<EmailDeliveryResult>;
}

