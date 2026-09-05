import * as React from 'react';
import { cn } from '@/lib/utils';

export const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn('flex h-11 w-full rounded-xl border border-input bg-card px-3.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-muted-foreground focus:ring-2 focus:ring-ring/20 disabled:opacity-50', className)}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
