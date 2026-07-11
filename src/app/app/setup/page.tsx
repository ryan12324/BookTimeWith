import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Onboarding } from "@/components/app/Onboarding";
import { getDb } from "@/db/client";
import { sessionOwner } from "@/lib/authz";

export const metadata = { title: "Set up" };
export const dynamic = "force-dynamic";

/**
 * Setup doubles as signup. A returning signed-in owner already has an account,
 * so a claim-link visit returns them to their bookings; anonymous visitors get
 * an independent signup rather than being coupled to the first database row.
 */
export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ handle?: string }>;
}) {
  const db = await getDb();
  const owner = await sessionOwner(db);
  if (owner?.setupCompletedAt) redirect("/app/bookings");

  // Resolve the promise so malformed framework input cannot become an unhandled
  // rejection before the client-side wizard reads the same URL query itself.
  await searchParams;

  return (
    <Suspense fallback={null}>
      <Onboarding />
    </Suspense>
  );
}
