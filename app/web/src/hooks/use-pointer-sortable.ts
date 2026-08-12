import { useEffect, useRef, useState, type PointerEventHandler } from "react";

export type SortableLocation = {
  group: string;
  id: string;
  index: number;
};

type ActiveDrag = {
  pointerId: number;
  source: SortableLocation;
  target: SortableLocation;
  x: number;
  y: number;
};

const itemSelector = "[data-pointer-sortable-item]";
const groupSelector = "[data-pointer-sortable-group]";

function locationFromElement(element: Element | null): SortableLocation | undefined {
  const item = element?.closest<HTMLElement>(itemSelector);
  if (!item) return undefined;
  const { sortableGroup: group, sortableId: id, sortableIndex: index } = item.dataset;
  const numericIndex = Number(index);
  if (!group || !id || !Number.isInteger(numericIndex)) return undefined;
  return { group, id, index: numericIndex };
}

function locationAtPoint(x: number, y: number): SortableLocation | undefined {
  const direct = document
    .elementsFromPoint(x, y)
    .map((element) => locationFromElement(element))
    .find((location) => location !== undefined);
  if (direct) return direct;

  const group = document
    .elementsFromPoint(x, y)
    .map((element) => element.closest<HTMLElement>(groupSelector))
    .find((element) => element !== null);
  if (!group?.dataset.pointerSortableGroup) return undefined;
  const first = group.querySelector<HTMLElement>(itemSelector);
  return first
    ? locationFromElement(first)
    : { group: group.dataset.pointerSortableGroup, id: "", index: 0 };
}

const groupProps = (group: string) => ({
  "data-pointer-sortable-group": group,
});

export function usePointerSortable({
  onMove,
}: {
  onMove: (source: SortableLocation, target: SortableLocation) => void;
}) {
  const drag = useRef<ActiveDrag | undefined>(undefined);
  const autoScrollFrame = useRef<number | undefined>(undefined);
  const listenerAbort = useRef<AbortController | undefined>(undefined);
  const onMoveRef = useRef(onMove);
  const [activeId, setActiveId] = useState<string>();
  const [overId, setOverId] = useState<string>();
  onMoveRef.current = onMove;

  const stopAutoScroll = () => {
    if (autoScrollFrame.current !== undefined) {
      window.cancelAnimationFrame(autoScrollFrame.current);
      autoScrollFrame.current = undefined;
    }
  };

  const finish = (cancelled: boolean) => {
    const current = drag.current;
    drag.current = undefined;
    listenerAbort.current?.abort();
    listenerAbort.current = undefined;
    stopAutoScroll();
    document.documentElement.classList.remove("pointer-sorting");
    setActiveId(undefined);
    setOverId(undefined);
    if (
      !cancelled &&
      current &&
      (current.source.group !== current.target.group ||
        current.source.index !== current.target.index)
    ) {
      onMoveRef.current(current.source, current.target);
    }
  };

  const autoScroll = () => {
    autoScrollFrame.current = undefined;
    const current = drag.current;
    if (!current) return;
    const edge = Math.min(88, window.innerHeight * 0.18);
    let speed = 0;
    if (current.y < edge) speed = -18 * (1 - Math.max(0, current.y) / edge);
    else if (current.y > window.innerHeight - edge) {
      speed =
        18 *
        (1 - Math.max(0, window.innerHeight - current.y) / edge);
    }
    if (speed) {
      window.scrollBy({ top: speed, behavior: "instant" });
      const next = locationAtPoint(current.x, current.y);
      if (next) {
        current.target = next;
        setOverId(next.id || undefined);
      }
      autoScrollFrame.current = window.requestAnimationFrame(autoScroll);
    }
  };

  useEffect(
    () => () => {
      stopAutoScroll();
      listenerAbort.current?.abort();
      document.documentElement.classList.remove("pointer-sorting");
    },
    [],
  );

  const handleProps = (
    location: SortableLocation,
    disabled: boolean,
  ): {
    onPointerDown: PointerEventHandler<HTMLButtonElement>;
    style: { touchAction: "none" };
  } => ({
    style: { touchAction: "none" },
    onPointerDown: (event) => {
      if (disabled || event.button !== 0 || drag.current) return;
      event.preventDefault();
      try {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } catch {
        // Synthetic pointers and some embedded browsers can reject capture.
        // The window listeners below still keep the drag functional.
      }
      drag.current = {
        pointerId: event.pointerId,
        source: location,
        target: location,
        x: event.clientX,
        y: event.clientY,
      };
      document.documentElement.classList.add("pointer-sorting");
      setActiveId(location.id);
      setOverId(location.id);

      const listeners = new AbortController();
      listenerAbort.current = listeners;
      const move = (pointerEvent: PointerEvent) => {
        const current = drag.current;
        if (!current || pointerEvent.pointerId !== current.pointerId) return;
        if (pointerEvent.cancelable) pointerEvent.preventDefault();
        current.x = pointerEvent.clientX;
        current.y = pointerEvent.clientY;
        const next = locationAtPoint(pointerEvent.clientX, pointerEvent.clientY);
        if (next) {
          current.target = next;
          setOverId(next.id || undefined);
        }
        if (autoScrollFrame.current === undefined) {
          autoScrollFrame.current = window.requestAnimationFrame(autoScroll);
        }
      };
      const end = (pointerEvent: PointerEvent) => {
        if (pointerEvent.pointerId !== drag.current?.pointerId) return;
        finish(false);
      };
      const cancel = (pointerEvent: PointerEvent) => {
        if (pointerEvent.pointerId !== drag.current?.pointerId) return;
        finish(true);
      };
      window.addEventListener("pointermove", move, {
        passive: false,
        signal: listeners.signal,
      });
      window.addEventListener("pointerup", end, { signal: listeners.signal });
      window.addEventListener("pointercancel", cancel, {
        signal: listeners.signal,
      });
    },
  });

  const itemProps = (location: SortableLocation) => ({
    "data-pointer-sortable-item": "",
    "data-sortable-active": activeId === location.id ? "true" : undefined,
    "data-sortable-group": location.group,
    "data-sortable-id": location.id,
    "data-sortable-index": String(location.index),
    "data-sortable-over": overId === location.id ? "true" : undefined,
  });

  return { groupProps, handleProps, itemProps };
}
