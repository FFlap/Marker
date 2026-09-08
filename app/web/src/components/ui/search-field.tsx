import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type SearchFieldProps = Omit<React.ComponentProps<typeof Input>, "size"> & {
  size?: "compact" | "prominent";
};

export const SearchField = React.forwardRef<HTMLInputElement, SearchFieldProps>(
  ({ className, size = "compact", ...props }, ref) => (
    <Input
      ref={ref}
      className={cn(
        "min-w-0",
        size === "compact" && "h-11 border-0 bg-card px-4 text-sm sm:h-9",
        size === "prominent" && "h-[54px] rounded-[14px] px-4 text-base",
        className,
      )}
      {...props}
    />
  ),
);
SearchField.displayName = "SearchField";
