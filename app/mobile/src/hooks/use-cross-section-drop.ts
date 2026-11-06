import { useRef, useState } from 'react';
import type { NativeGridDropTarget } from '@/components/NativeDraggableGrid';
import type { Status } from '@/types';

/** Share insertion hit testing between library and tag collections. */
export function useCrossSectionDrop() {
  const targets = useRef<Partial<Record<Status, NativeGridDropTarget>>>({});
  const indexRef = useRef<number | undefined>(undefined);
  const [index, setIndex] = useState<number>();
  const pendingIndex = useRef<number | undefined>(undefined);
  const update = (status: Status | undefined, x: number, y: number, offset: number) => {
    // Window geometry accounts for parent padding and the current scroll offset.
    let selected: ReturnType<NativeGridDropTarget> | undefined;
    for (const [key, target] of Object.entries(targets.current)) {
      const candidate = target?.(x, y, offset);
      if (key === status) selected = candidate;
      if (candidate?.distance === 0) {
        status = key as Status;
        selected = candidate;
        break;
      }
    }
    if (selected && !Number.isFinite(selected.distance)) status = undefined;
    const next = status ? (selected?.index ?? 0) : undefined;
    indexRef.current = next;
    setIndex(next);
    return status;
  };
  const clear = () => {
    indexRef.current = undefined;
    setIndex(undefined);
  };
  return { targets, index, indexRef, pendingIndex, update, clear };
}
