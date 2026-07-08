import type { Metadata } from "next";
import { ManageFlow } from "@/components/client/ManageFlow";

export const metadata: Metadata = {
  title: "Manage your booking",
  robots: { index: false },
};

/**
 * Client manage page. The [token] is a signed, expiring magic-link token
 * (validated server-side in phase 2 — see README data model `manage_tokens`).
 * No account, no login.
 */
export default async function ManagePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  await params; // token validated server-side in phase 2
  return <ManageFlow />;
}
