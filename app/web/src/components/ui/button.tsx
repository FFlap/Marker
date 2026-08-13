import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-45',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/88',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-accent',
        outline: 'border border-border bg-transparent text-foreground hover:bg-accent',
        ghost: 'text-muted-foreground hover:bg-accent hover:text-foreground',
        destructive: 'bg-destructive/12 text-destructive hover:bg-destructive/20',
      },
      size: {
        default: 'h-11 px-5 sm:h-10',
        sm: 'h-11 px-3 text-xs sm:h-8',
        lg: 'h-12 px-7',
        icon: 'size-11 p-0 sm:size-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, type, disabled, onClick, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
        {...(asChild
          ? {
              'aria-disabled': disabled || undefined,
              tabIndex: disabled ? -1 : props.tabIndex,
              onClick: disabled
                ? (event: React.MouseEvent<HTMLElement>) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }
                : onClick,
            }
          : { type: type ?? 'button', disabled, onClick })}
      />
    );
  },
);
Button.displayName = 'Button';
