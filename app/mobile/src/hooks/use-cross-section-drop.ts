import { useRef, useState } from 'react';
import type { NativeGridDropTarget } from '@/components/NativeDraggableGrid';
import type { Status } from '@/types';

/** Share insertion hit testing between library and tag collections. */
export function useCrossSectionDrop() {
  const targets = useRef<Partial<Record<Status, NativeGridDropTarget>>>({});
  const statusRef = useRef<Status | undefined>(undefined);
  const indexRef = useRef<number | undefined>(undefined);
  const [index, setIndex] = useState<number>();
  const pendingIndex = useRef<number | undefined>(undefined);
  /** Resolve a measured slot from window coordinates and the parent scroll offset. */
  const update = (status: Status | undefined, x: number, y: number, offset: number) => {
    // Window geometry accounts for parent padding and the current scroll offset.
    const measured = Object.entries(targets.current).map(([key, target]) => ({
      status: key as Status,
      target: target?.(x, y, offset),
    }));
    let selected = measured.find((entry) => entry.status === status)?.target;
    const matches = measured.filter((entry) => entry.target?.distance === 0);
    // A gap can expand one grid before its neighbor's window origin is updated.
    // Retain the current destination while both claim the pointer; switching
    // becomes safe once the previous grid no longer contains it.
    const match =
      matches.find((entry) => entry.status === statusRef.current) ??
      matches.find((entry) => entry.status === status) ??
      matches[0];
    if (match) {
      status = match.status;
      selected = match.target;
    }
    if (selected && !Number.isFinite(selected.distance)) status = undefined;
    statusRef.current = status;
    const next = status ? (selected?.index ?? 0) : undefined;
    indexRef.current = next;
    setIndex(next);
    return status;
  };
  /** Clear hover state while retaining placement for a pending Watched confirmation. */
  const clear = () => {
    statusRef.current = undefined;
    indexRef.current = undefined;
    setIndex(undefined);
  };
  return { targets, index, indexRef, pendingIndex, update, clear };
}
