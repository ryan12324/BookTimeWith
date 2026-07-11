import { ImageResponse } from "next/og";
import { getDb } from "@/db/client";
import { getOwnerConfig, ownerByHandle } from "@/db/repo";
import { fmtDuration } from "@/lib/format";

/**
 * OG image for booking pages (README "Public booking page extras"): generated
 * from the owner's real name + service on the paper background with serif
 * type, matching the design tokens. Rendered on demand per handle.
 */

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Book a time";

/** Best-effort cached font load; OG generation must not hang on Google Fonts. */
let serifPromise: Promise<ArrayBuffer | null> | undefined;

async function fetchSerif(): Promise<ArrayBuffer | null> {
  try {
    const cssResponse = await fetch(
      "https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@600",
      // No modern UA → Google serves TTF, which satori can consume.
      {
        headers: { "User-Agent": "curl/8" },
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!cssResponse.ok) return null;
    const css = await cssResponse.text();
    const url = css.match(/src: url\((.+?)\)/)?.[1];
    if (!url) return null;
    const fontResponse = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    return fontResponse.ok ? await fontResponse.arrayBuffer() : null;
  } catch {
    return null;
  }
}

const loadSerif = () => (serifPromise ??= fetchSerif());

export default async function OgImage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const serif = await loadSerif();
  const db = await getDb();
  const owner = await ownerByHandle(db, handle.toLowerCase());
  const cfg = owner ? await getOwnerConfig(db, owner.id) : null;
  const ownerFirst = cfg?.name.split(",")[0] || handle;
  const serviceLine = cfg?.service
    ? `${cfg.service} · ${fmtDuration(cfg.duration)}`
    : "Book a time";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 96px",
          backgroundColor: "#faf8f4",
          color: "#26221c",
        }}
      >
        <div
          style={{
            fontSize: 30,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "#71695d",
          }}
        >
          Book time with
        </div>
        <div
          style={{
            marginTop: 18,
            fontSize: 92,
            fontFamily: serif ? "Source Serif 4" : "serif",
            fontWeight: 600,
            letterSpacing: "-0.01em",
          }}
        >
          {ownerFirst}
        </div>
        <div style={{ marginTop: 22, fontSize: 38, color: "#6b6357" }}>
          {serviceLine}
        </div>
        <div
          style={{
            marginTop: 64,
            paddingTop: 32,
            borderTop: "2px solid #e6dfd3",
            fontSize: 28,
            color: "#776a50",
          }}
        >
          {`booktimewith.link/${handle} · No account needed. Ever.`}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: serif
        ? [{ name: "Source Serif 4", data: serif, weight: 600 as const }]
        : undefined,
    },
  );
}
