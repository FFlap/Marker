import { cn } from "@/lib/utils";

export type ChipOption<T extends string | number> = {
  value: T;
  label: string;
  ariaLabel?: string;
};

export function ChipGroup<T extends string | number>({
  label,
  options,
  value,
  onChange,
  isSelected,
  className,
}: {
  label: string;
  options: Array<ChipOption<T>>;
  value: T;
  onChange: (value: T) => void;
  isSelected?: (value: T) => boolean;
  className?: string;
}) {
  return (
    <section>
      <p className="mb-3 text-xs font-semibold text-muted-foreground">
        {label}
      </p>
      <div className={cn("flex flex-wrap gap-2", className)}>
        {options.map((option) => {
          const selected = isSelected
            ? isSelected(option.value)
            : value === option.value;
          return (
            <button
              type="button"
              key={String(option.value)}
              aria-label={option.ariaLabel}
              aria-pressed={selected}
              className={`min-h-11 rounded-full border px-3 py-1.5 text-sm font-semibold transition sm:min-h-9 ${selected ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground"}`}
              onClick={() => onChange(option.value)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
