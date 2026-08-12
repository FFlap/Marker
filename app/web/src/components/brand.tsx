import { cn } from "@/lib/utils";

export function Brand({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="relative grid size-9 place-items-center rounded-xl border border-white/10 bg-white text-black shadow-[0_8px_28px_rgba(255,255,255,.08)]">
        <span
          aria-hidden="true"
          className="-translate-y-px text-xl font-bold leading-none"
        >
          m
        </span>
        <span
          aria-hidden="true"
          className="absolute bottom-1.5 h-[2px] w-3 rounded-full bg-black"
        />
      </div>
      {compact ? (
        <span className="sr-only">Marker</span>
      ) : (
        <span className="text-[15px] font-bold tracking-[-0.03em]">Marker</span>
      )}
    </div>
  );
}
