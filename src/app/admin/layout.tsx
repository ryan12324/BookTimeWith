import Link from "next/link";
import { redirect } from "next/navigation";
import { Wordmark } from "@/components/ui";
import { getDb } from "@/db/client";
import { requireAdminSession } from "@/lib/admin-auth";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const db = await getDb();
  const admin = await requireAdminSession(db);

  if (!admin) {
    redirect("/signin");
  }

  return (
    <div className="min-h-screen bg-paper-dim">
      <header className="mx-auto max-w-[1200px] px-6 pt-9 md:px-8">
        <nav
          aria-label="Admin navigation"
          className="flex flex-wrap items-center justify-between gap-4"
        >
          <div className="flex items-center gap-3">
            <Wordmark size={16} />
            <span className="rounded-chip bg-bronze px-2 py-1 font-sans text-[11px] font-semibold uppercase tracking-wide text-paper">
              Admin
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/app"
              className="min-h-[44px] px-2 font-sans text-[12px] font-semibold text-bronze-ink"
            >
              Back to app
            </Link>
            <form action="/api/auth/signout" method="post">
              <button
                type="submit"
                className="min-h-[44px] px-2 font-sans text-[12px] font-semibold text-body hover:text-ink"
              >
                Sign out
              </button>
            </form>
          </div>
        </nav>
      </header>
      <main id="main-content" className="mx-auto max-w-[1200px] px-6 pb-16 md:px-8">
        {children}
      </main>
    </div>
  );
}
