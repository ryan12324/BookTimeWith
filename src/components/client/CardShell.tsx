import { StripedAvatar } from "@/components/ui";

/**
 * Shared client-card chrome (booking + manage). Phone-first: edge-to-edge with
 * no border below `sm` (the paper page *is* the card), floating card at `sm`+.
 */
export function CardShell({
  ownerName,
  serviceLine,
  children,
}: {
  ownerName: string;
  serviceLine: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-[420px]">
      <div className="overflow-hidden bg-white sm:rounded-card-lg sm:border sm:border-line-soft sm:shadow-float">
        <header className="flex items-center gap-[14px] border-b border-hairline px-[26px] py-[22px]">
          <StripedAvatar size={44} />
          <div className="min-w-0">
            <div className="break-words font-serif text-[16px] font-semibold">{ownerName}</div>
            <div className="break-words font-sans text-[12.5px] text-body">{serviceLine}</div>
          </div>
        </header>
        {children}
      </div>
      <div className="mt-[14px] text-center font-sans text-[11px] text-faint">
        powered by booktimewith.com
      </div>
    </div>
  );
}
