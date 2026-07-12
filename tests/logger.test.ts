import { afterEach, describe, expect, it, vi } from "vitest";
import { log } from "@/lib/logger";

describe("structured server logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.LOG_LEVEL;
  });

  it("emits machine-readable event context", () => {
    process.env.LOG_LEVEL = "info";
    const output = vi.spyOn(console, "info").mockImplementation(() => undefined);
    log.info("booking.created", { bookingId: "booking-1", durationMs: 12 });
    const entry = JSON.parse(String(output.mock.calls[0]?.[0]));
    expect(entry).toMatchObject({
      level: "info",
      service: "booktimewith",
      event: "booking.created",
      bookingId: "booking-1",
      durationMs: 12,
    });
    expect(entry.timestamp).toBeTypeOf("string");
  });

  it("recursively redacts credentials and personal data", () => {
    process.env.LOG_LEVEL = "error";
    const output = vi.spyOn(console, "error").mockImplementation(() => undefined);
    log.error("provider.failed", {
      authorization: "Bearer top-secret",
      nested: { clientEmail: "person@example.com", accessToken: "abc" },
      error: new Error("failure for person@example.com using Bearer credential"),
    });
    const line = String(output.mock.calls[0]?.[0]);
    expect(line).not.toContain("top-secret");
    expect(line).not.toContain("person@example.com");
    expect(line).not.toContain("credential");
    const entry = JSON.parse(line);
    expect(entry.authorization).toBe("[REDACTED]");
    expect(entry.nested.clientEmail).toBe("[REDACTED]");
    expect(entry.nested.accessToken).toBe("[REDACTED]");
  });
});
