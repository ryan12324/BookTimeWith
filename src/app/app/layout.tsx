import { OwnerConfigProvider } from "@/lib/store";
import { OwnerNav } from "@/components/app/OwnerNav";

/**
 * Owner app shell (booktimewith.com). Wraps every owner view in the shared
 * config store so edits in setup and settings stay in sync — and flow through
 * to the public booking page, which reads the same persisted config.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <OwnerConfigProvider>
      <div className="min-h-screen bg-paper-dim">
        <OwnerNav />
        <div className="mx-auto max-w-[960px] px-6 pb-16 md:px-8">{children}</div>
      </div>
    </OwnerConfigProvider>
  );
}
