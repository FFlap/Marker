import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type SearchFieldProps = Omit<React.ComponentProps<typeof Input>, "size"> & {
  size?: "compact" | "prominent";
  wrapperClassName?: string;
};

export const SearchField = React.forwardRef<HTMLInputElement, SearchFieldProps>(
  ({ className, size = "compact", wrapperClassName, ...props }, ref) => (
    <div className={cn("relative", wrapperClassName)}>
      <Input
        ref={ref}
        className={cn(
          size === "compact" && "h-11 border-0 bg-card px-4 text-sm sm:h-9",
          size === "prominent" && "h-[54px] rounded-[14px] px-4 text-base",
          className,
        )}
        {...props}
      />
    </div>
  ),
);
SearchField.displayName = "SearchField";
