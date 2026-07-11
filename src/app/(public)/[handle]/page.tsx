import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { RESERVED_HANDLES } from "@/lib/handles";
import { getDb } from "@/db/client";
import { ownerByHandle } from "@/db/repo";
import { BookingFlow } from "@/components/client/BookingFlow";

export const dynamic = "force-dynamic";

async function resolve(handle: string) {
  if (RESERVED_HANDLES.has(handle.toLowerCase())) return null;
  const db = await getDb();
  return (await ownerByHandle(db, handle.toLowerCase())) ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const owner = await resolve(handle);
  const name = owner?.name?.split(",")[0] || handle;
  const title = `Book time with ${name}`;
  const description = `Pick a time with ${name} — no account needed.`;
  // The OG image itself comes from ./opengraph-image.tsx (name + service on
  // the paper/serif tokens).
  return {
    title,
    description,
    alternates: { canonical: `https://booktimewith.link/${handle}` },
    openGraph: {
      title,
      description,
      url: `https://booktimewith.link/${handle}`,
      siteName: "Book Time With",
      type: "website",
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function BookingPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const owner = await resolve(handle);
  if (!owner) notFound(); // unknown or reserved handles are 404s
  // Old handles redirect to the current one for 90 days (handle_redirects).
  if (owner.handle !== handle.toLowerCase()) redirect(`/${owner.handle}`);
  return <BookingFlow />;
}
