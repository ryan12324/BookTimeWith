import type { Metadata } from "next";
import { ManageFlow } from "@/components/client/ManageFlow";

export const metadata: Metadata = {
  title: "Manage your booking",
  robots: { index: false },
};

/**
 * Client manage page. The [token] is the hashed, expiring magic-link token
 * from client emails, resolved via /api/manage/[token]. No account, no login.
 */
export default async function ManagePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <ManageFlow token={token} />;
}
