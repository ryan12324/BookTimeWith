import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RESERVED_HANDLES } from "@/lib/handles";
import { OWNER_NAME } from "@/lib/mock";
import { BookingFlow } from "@/components/client/BookingFlow";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  // OG image is generated from name + service in production (paper + serif tokens).
  return {
    title: `Book time with ${OWNER_NAME.split(",")[0]}`,
    description: `Pick a time with ${OWNER_NAME.split(",")[0]} — no account needed.`,
    alternates: { canonical: `https://booktimewith.link/${handle}` },
  };
}

export default async function BookingPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  // Reserved paths aren't bookable handles. In production an unknown handle 404s;
  // in this demo every other handle renders the mock owner (Dana).
  if (RESERVED_HANDLES.has(handle.toLowerCase())) notFound();
  return <BookingFlow />;
}
