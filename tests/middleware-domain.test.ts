import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../src/middleware";

describe("production domain routing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows API calls between product domains without sharing credentials", async () => {
    const request = new NextRequest("https://booktimewith.link/api/slots?handle=dana", {
      headers: {
        host: "booktimewith.link",
        origin: "https://booktimewith.com",
      },
    });

    const response = await middleware(request);

    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://booktimewith.com",
    );
    expect(response.headers.get("access-control-allow-methods")).toContain("GET");
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    expect(response.headers.get("vary")).toContain("Origin");
  });

  it("answers valid preflights and does not trust other origins", async () => {
    const preflight = new NextRequest("https://booktimewith.link/api/bookings", {
      method: "OPTIONS",
      headers: {
        host: "booktimewith.link",
        origin: "https://booktimewith.com",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });
    const untrusted = new NextRequest("https://booktimewith.link/api/slots", {
      headers: {
        host: "booktimewith.link",
        origin: "https://evil.example",
      },
    });

    const preflightResponse = await middleware(preflight);
    const untrustedResponse = await middleware(untrusted);

    expect(preflightResponse.status).toBe(204);
    expect(preflightResponse.headers.get("access-control-allow-origin")).toBe(
      "https://booktimewith.com",
    );
    expect(untrustedResponse.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("moves an uppercase public handle off the owner-cookie domain", async () => {
    const request = new NextRequest("https://booktimewith.com/DANA?from=email", {
      headers: { host: "booktimewith.com" },
    });

    const response = await middleware(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://booktimewith.link/dana?from=email",
    );
  });

  it("does not treat a case-variant reserved product path as a public handle", async () => {
    const request = new NextRequest("https://booktimewith.com/ADMIN", {
      headers: { host: "booktimewith.com" },
    });

    const response = await middleware(request);

    expect(response.headers.get("location")).toBeNull();
  });

  it("normalizes an encoded handle before moving UGC off the owner domain", async () => {
    const request = new NextRequest(
      "https://booktimewith.com/%64ana?from=encoded",
      { headers: { host: "booktimewith.com" } },
    );

    const response = await middleware(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://booktimewith.link/dana?from=encoded",
    );
  });

  it("applies the production session gate to an encoded owner page", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_TOKEN_SECRET", "a".repeat(32));
    const request = new NextRequest("https://booktimewith.com/%65mails", {
      headers: { host: "booktimewith.com" },
    });

    const response = await middleware(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://booktimewith.com/signin?next=%2Femails",
    );
  });

  it("moves an encoded owner page off the public booking domain", async () => {
    const request = new NextRequest("https://booktimewith.link/%65mails", {
      headers: { host: "booktimewith.link" },
    });

    const response = await middleware(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://booktimewith.com/emails",
    );
  });

  it("canonicalizes an encoded handle on the public booking domain", async () => {
    const request = new NextRequest("https://booktimewith.link/%64ana", {
      headers: { host: "booktimewith.link" },
    });

    const response = await middleware(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://booktimewith.link/dana",
    );
  });

  it("rejects encoded backslash, control, and double-encoded path forms", async () => {
    for (const pathname of ["/%5cemails", "/%0aemails", "/%2565mails"]) {
      const request = new NextRequest(`https://booktimewith.com${pathname}`, {
        headers: { host: "booktimewith.com" },
      });
      const response = await middleware(request);
      expect(response.status, pathname).toBe(400);
    }

    const encodedApi = new NextRequest(
      "https://booktimewith.link/api/%6fwner?public=1&handle=dana",
      { headers: { host: "booktimewith.link" } },
    );
    expect((await middleware(encodedApi)).status).toBe(400);
  });
});
