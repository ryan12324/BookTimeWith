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
        <div className="flex items-center gap-[14px] border-b border-hairline px-[26px] py-[22px]">
          <StripedAvatar size={44} />
          <div>
            <div className="font-serif text-[16px] font-semibold">{ownerName}</div>
            <div className="font-sans text-[12.5px] text-faint">{serviceLine}</div>
          </div>
        </div>
        {children}
      </div>
      <div className="mt-[14px] text-center font-sans text-[11px] text-faint">
        powered by booktimewith.com
      </div>
    </div>
  );
}
