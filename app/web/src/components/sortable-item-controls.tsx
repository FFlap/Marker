import { useState, type KeyboardEventHandler, type ReactNode } from "react";
import { ArrowDown, ArrowUp, EllipsisVertical, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function SortableHandle({
  disabled,
  label,
  onKeyDown,
  pointerProps,
}: {
  disabled: boolean;
  label: string;
  onKeyDown: KeyboardEventHandler<HTMLButtonElement>;
  pointerProps: React.ButtonHTMLAttributes<HTMLButtonElement>;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
      disabled={disabled}
      onKeyDown={onKeyDown}
      className="grid size-11 shrink-0 cursor-grab touch-none place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing disabled:cursor-default disabled:opacity-35 sm:size-9"
      {...pointerProps}
    >
      <GripVertical className="size-4" />
    </button>
  );
}

export function SortableItemActions({
  title,
  disabled,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  status,
  statuses,
  onMoveToStatus,
  children,
}: {
  title: string;
  disabled: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  status?: string;
  statuses?: ReadonlyArray<{ label: string; value: string }>;
  onMoveToStatus?: (status: string) => void;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const run = (action: () => void) => {
    setOpen(false);
    action();
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Open actions for ${title}`}
          className="shrink-0"
        >
          <EllipsisVertical className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogTitle>{title} actions</DialogTitle>
        <div className="grid gap-2">
          <Button
            variant="outline"
            className="justify-start"
            disabled={disabled || !canMoveUp}
            onClick={() => run(onMoveUp)}
          >
            <ArrowUp className="size-4" /> Move up
          </Button>
          <Button
            variant="outline"
            className="justify-start"
            disabled={disabled || !canMoveDown}
            onClick={() => run(onMoveDown)}
          >
            <ArrowDown className="size-4" /> Move down
          </Button>
        </div>
        {statuses?.length && onMoveToStatus ? (
          <div>
            <p className="mb-2 text-[11px] font-semibold text-muted-foreground">
              Move to status
            </p>
            <div className="grid grid-cols-2 gap-2">
              {statuses.map((option) => (
                <Button
                  key={option.value}
                  variant="ghost"
                  disabled={disabled || option.value === status}
                  aria-current={option.value === status ? "true" : undefined}
                  onClick={() => run(() => onMoveToStatus(option.value))}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
        {children}
      </DialogContent>
    </Dialog>
  );
}
