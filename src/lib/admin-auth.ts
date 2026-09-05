import type { Db } from "@/db/client";
import { sessionOwner } from "@/lib/authz";

function getAdminEmails(): Set<string> {
  const raw = process.env.ADMIN_EMAILS?.trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAdminEmail(email: string): boolean {
  return getAdminEmails().has(email.toLowerCase());
}

export interface AdminSession {
  ownerId: string;
  email: string;
}

export async function requireAdminSession(db: Db): Promise<AdminSession | null> {
  const owner = await sessionOwner(db);
  if (!owner) return null;
  if (!isAdminEmail(owner.email)) return null;
  return { ownerId: owner.id, email: owner.email };
}
