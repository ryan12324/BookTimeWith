import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { getDb } from "@/db/client";
import { sessionOwner } from "@/lib/authz";

export const dynamic = "force-dynamic";

/** The dev outbox: every email the pipeline "sent", newest first (/emails). */
export async function GET() {
  const db = await getDb();
  const owner = await sessionOwner(db);
  if (process.env.NODE_ENV === "production") {
    if (!owner) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const base = db.select().from(schema.emailOutbox);
  const rows = owner
    ? await base
        .where(eq(schema.emailOutbox.ownerId, owner.id))
        .orderBy(desc(schema.emailOutbox.createdAt))
        .limit(50)
    : await base.orderBy(desc(schema.emailOutbox.createdAt)).limit(50);
  return NextResponse.json({
    emails: rows.map((r) => ({
      id: r.id,
      to: r.toEmail,
      from: r.fromLine,
      replyTo: r.replyTo,
      subject: r.subject,
      template: r.template,
      createdAt: r.createdAt.toISOString(),
      html: r.html,
      attachments: r.attachments ? (JSON.parse(r.attachments) as unknown[]) : [],
      delivery: r.delivery,
    })),
  });
}
