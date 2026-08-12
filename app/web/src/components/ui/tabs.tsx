import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';

export const Tabs = TabsPrimitive.Root;
export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn('inline-flex h-10 items-center rounded-full border border-border bg-card p-1', className)} {...props} />;
}
export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return <TabsPrimitive.Trigger className={cn('inline-flex items-center justify-center gap-2 rounded-full px-4 py-1.5 text-xs font-semibold leading-none text-muted-foreground transition data-[state=active]:bg-foreground data-[state=active]:text-background', className)} {...props} />;
}
