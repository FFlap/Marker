import type { DragEvent } from 'react';

export type WebReorderSession<Status extends string> = {
  autoScrollFrame?: number;
  dropZone?: HTMLElement;
  dropped: boolean;
  frame?: number;
  from: number;
  itemId: string;
  nodes: HTMLElement[];
  over: number;
  pendingOver: number;
  pointerX: number;
  pointerY: number;
  rects: { height: number; left: number; top: number; width: number }[];
  reducedMotion: boolean;
  scrollElement: HTMLElement;
  status: Status;
};

let activeSession: WebReorderSession<string> | undefined;

export const getWebReorderSession = <Status extends string>() =>
  activeSession as WebReorderSession<Status> | undefined;

export const activateWebReorderSession = <Status extends string>(
  session: WebReorderSession<Status>,
) => {
  activeSession = session;
  return session;
};

export const startWebReorderSession = <Status extends string>(
  session: Omit<
    WebReorderSession<Status>,
    'dropped' | 'over' | 'pendingOver' | 'rects' | 'reducedMotion'
  >,
) => {
  const next: WebReorderSession<Status> = {
    ...session,
    dropped: false,
    over: session.from,
    pendingOver: session.from,
    rects: session.nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { height: rect.height, left: rect.left, top: rect.top, width: rect.width };
    }),
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
  activeSession = next;
  return next;
};

export const clearWebReorderSession = () => {
  const session = activeSession;
  if (!session) return;
  if (session.frame !== undefined) window.cancelAnimationFrame(session.frame);
  if (session.autoScrollFrame !== undefined) window.cancelAnimationFrame(session.autoScrollFrame);
  if (session.dropZone) {
    session.dropZone.style.backgroundColor = '';
    session.dropZone.style.boxShadow = '';
    session.dropZone.style.borderRadius = '';
  }
  for (const node of session.nodes) {
    node.style.backgroundColor = '';
    node.style.borderRadius = '';
    node.style.boxShadow = '';
    node.style.opacity = '';
    node.style.transform = '';
    node.style.transition = '';
    node.style.willChange = '';
    node.style.zIndex = '';
    node.removeAttribute('aria-grabbed');
  }
  activeSession = undefined;
};

export const webReorderIndexAtPoint = (clientX: number, clientY: number) => {
  const session = activeSession;
  if (!session) return;
  const columns = new Set(session.rects.map((rect) => Math.round(rect.left))).size;
  let nearest = session.over;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const [index, rect] of session.rects.entries()) {
    const x = columns > 1 ? (clientX - (rect.left + rect.width / 2)) / Math.max(rect.width, 1) : 0;
    const y = (clientY - (rect.top + rect.height / 2)) / Math.max(rect.height, 1);
    const distance = x * x + y * y;
    if (distance < nearestDistance) {
      nearest = index;
      nearestDistance = distance;
    }
  }
  return nearest;
};

export const positionWebReorder = (over: number) => {
  const session = activeSession;
  if (!session) return;
  session.over = over;
  for (const [index, node] of session.nodes.entries()) {
    let destination = index;
    if (index === session.from) destination = over;
    else if (session.from < over && index > session.from && index <= over) destination = index - 1;
    else if (session.from > over && index >= over && index < session.from) destination = index + 1;
    const fromRect = session.rects[index];
    const toRect = session.rects[destination];
    if (!fromRect || !toRect) continue;
    node.style.transition = session.reducedMotion
      ? 'none'
      : 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1), opacity 140ms ease-out';
    node.style.transform = `translate3d(${toRect.left - fromRect.left}px, ${toRect.top - fromRect.top}px, 0)`;
    node.style.willChange = 'transform';
    if (index === session.from) {
      node.style.opacity = '0';
      node.setAttribute('aria-grabbed', 'true');
    }
  }
};

export const scheduleWebReorder = (over: number) => {
  const session = activeSession;
  if (!session) return;
  session.pendingOver = over;
  if (session.frame !== undefined) return;
  session.frame = window.requestAnimationFrame(() => {
    const current = activeSession;
    if (!current) return;
    current.frame = undefined;
    if (current.over !== current.pendingOver) positionWebReorder(current.pendingOver);
  });
};

const runAutoScroll = () => {
  const session = activeSession;
  if (!session) return;
  session.autoScrollFrame = undefined;
  const bounds = session.scrollElement.getBoundingClientRect();
  const edge = Math.min(84, bounds.height * 0.18);
  const topDistance = session.pointerY - bounds.top;
  const bottomDistance = bounds.bottom - session.pointerY;
  let speed = 0;
  if (topDistance < edge) speed = -20 * Math.max(0, 1 - Math.max(0, topDistance) / edge);
  else if (bottomDistance < edge) speed = 20 * Math.max(0, 1 - Math.max(0, bottomDistance) / edge);
  if (!speed) return;
  const before = session.scrollElement.scrollTop;
  session.scrollElement.scrollTop += speed;
  const delta = session.scrollElement.scrollTop - before;
  if (!delta) return;
  session.rects = session.rects.map((rect) => ({ ...rect, top: rect.top - delta }));
  const over = webReorderIndexAtPoint(session.pointerX, session.pointerY);
  if (over !== undefined) scheduleWebReorder(over);
  session.autoScrollFrame = window.requestAnimationFrame(runAutoScroll);
};

export const updateWebReorderAutoScroll = (clientX: number, clientY: number) => {
  const session = activeSession;
  if (!session) return;
  session.pointerX = clientX;
  session.pointerY = clientY;
  if (session.autoScrollFrame === undefined)
    session.autoScrollFrame = window.requestAnimationFrame(runAutoScroll);
};

export const webStatusDropZoneProps = <Status extends string>(
  disabled: boolean,
  status: Status,
  onCrossDrop: (itemId: string, status: Status) => void,
  highlight: { backgroundColor: string; borderColor: string },
) => ({
  onDragEnter: (event: DragEvent<HTMLDivElement>) => {
    const session = getWebReorderSession<Status>();
    if (disabled || !session) return;
    if (session.status === status) {
      if (session.dropZone) {
        session.dropZone.style.backgroundColor = '';
        session.dropZone.style.boxShadow = '';
        session.dropZone.style.borderRadius = '';
        session.dropZone = undefined;
      }
      return;
    }
    event.preventDefault();
    if (session.dropZone && session.dropZone !== event.currentTarget) {
      session.dropZone.style.backgroundColor = '';
      session.dropZone.style.boxShadow = '';
      session.dropZone.style.borderRadius = '';
    }
    session.dropZone = event.currentTarget;
    event.currentTarget.style.backgroundColor = highlight.backgroundColor;
    event.currentTarget.style.borderRadius = '12px';
    event.currentTarget.style.boxShadow = `inset 0 0 0 1px ${highlight.borderColor}`;
  },
  onDragOver: (event: DragEvent<HTMLDivElement>) => {
    const session = getWebReorderSession<Status>();
    if (disabled || !session || session.status === status) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  },
  onDragLeave: (event: DragEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    const session = getWebReorderSession<Status>();
    if (session?.dropZone !== event.currentTarget) return;
    event.currentTarget.style.backgroundColor = '';
    event.currentTarget.style.boxShadow = '';
    event.currentTarget.style.borderRadius = '';
    session.dropZone = undefined;
  },
  onDrop: (event: DragEvent<HTMLDivElement>) => {
    const session = getWebReorderSession<Status>();
    if (disabled || !session || session.status === status) return;
    event.preventDefault();
    session.dropped = true;
    const itemId = session.itemId;
    clearWebReorderSession();
    onCrossDrop(itemId, status);
  },
});
