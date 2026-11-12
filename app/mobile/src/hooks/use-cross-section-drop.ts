import { useRef, useState } from 'react';
import type { NativeGridDropTarget } from '@/components/NativeDraggableGrid';
import type { Status } from '@/types';
import { LIBRARY_STATUSES } from '@/lib/libraryFilters';

/** Share insertion hit testing between library and tag collections. */
export function useCrossSectionDrop() {
  const targets = useRef<Partial<Record<Status, NativeGridDropTarget>>>({});
  const indexRef = useRef<number | undefined>(undefined);
  const [index, setIndex] = useState<number>();
  const pendingIndex = useRef<number | undefined>(undefined);
  /** Resolve a measured slot from window coordinates and the parent scroll offset. */
  const update = (status: Status | undefined, x: number, y: number, offset: number) => {
    // Window geometry accounts for parent padding and the current scroll offset.
    const measured = LIBRARY_STATUSES.map(([key]) => ({
      status: key,
      target: targets.current[key]?.(x, y, offset),
    }));
    let selected = measured.find((entry) => entry.status === status)?.target;
    // Sections flow downward. An earlier grid's measured expansion owns the
    // overlap until the later grid's origin catches up, even on a rapid return
    // from that later source. Hover history must not override that geometry.
    const match = measured.find((entry) => entry.target?.distance === 0);
    if (match) {
      status = match.status;
      selected = match.target;
    }
    if (selected && !Number.isFinite(selected.distance)) status = undefined;
    const next = status ? (selected?.index ?? 0) : undefined;
    indexRef.current = next;
    setIndex(next);
    return status;
  };
  /** Clear hover state while retaining placement for a pending Watched confirmation. */
  const clear = () => {
    indexRef.current = undefined;
    setIndex(undefined);
  };
  return { targets, index, indexRef, pendingIndex, update, clear };
}
