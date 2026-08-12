import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn('text-xl font-bold tracking-tight', className)} {...props} />
));
DialogTitle.displayName = 'DialogTitle';

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 h-[100dvh] bg-black/72 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn('fixed left-[max(.5rem,env(safe-area-inset-left))] right-[max(.5rem,env(safe-area-inset-right))] top-[max(.5rem,env(safe-area-inset-top))] z-50 grid max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-1rem)] w-auto translate-x-0 translate-y-0 gap-5 overflow-y-auto rounded-2xl border border-border bg-background p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl data-[state=open]:animate-dialog-in sm:left-1/2 sm:right-auto sm:top-1/2 sm:max-h-[min(720px,calc(100dvh-2rem))] sm:w-[calc(100%-2rem)] sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:p-6', className)}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-3 top-3 grid size-11 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring sm:right-4 sm:top-4 sm:size-8">
        <X className="size-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = 'DialogContent';
