import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../src/middleware";

describe("production domain routing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
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
