import { useCallback, useEffect, useRef } from 'react';
import type {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
} from 'react-native';

/**
 * For tabs that swap content inside one vertical scroll view: each tab returns to where it
 * was left, and a tab not visited yet opens at its start (the top of the tab content) rather
 * than at whatever depth the previous tab was scrolled to.
 */
export function useTabScrollMemory<
  T extends string,
  S extends { scrollTo: ScrollView['scrollTo'] } = ScrollView,
>(
  tab: T,
  {
    topInset = 0,
    resetKey,
  }: {
    /** Height of the bar floating over the scroll view, so the tabs stop just below it. */
    topInset?: number;
    /** When this changes (a new search), every tab starts over at its beginning. */
    resetKey?: string;
  } = {},
) {
  const scrollRef = useRef<S>(null);
  const offset = useRef(0);
  const contentTop = useRef(0);
  const saved = useRef<Partial<Record<T, number>>>({});
  const previous = useRef(tab);
  // A restore still waiting for the content to grow tall enough (see onContentSizeChange).
  const pending = useRef<number | undefined>(undefined);
  // Where the outgoing tab was when a swipe began: the pager blends page heights during the
  // swipe, which can clamp the live offset before the new tab commits.
  const swipeStart = useRef<number | undefined>(undefined);
  useEffect(() => {
    saved.current = {};
    pending.current = undefined;
  }, [resetKey]);

  useEffect(() => {
    if (previous.current === tab) return;
    // A restore that never landed still marks where that tab belongs.
    saved.current[previous.current] = swipeStart.current ?? pending.current ?? offset.current;
    swipeStart.current = undefined;
    previous.current = tab;
    pending.current = undefined;
    const start = Math.max(0, contentTop.current - topInset);
    const target = saved.current[tab] ?? Math.min(offset.current, start);
    if (target === offset.current) return;
    // The destination page may still be growing (the pager animates its height), which would
    // clamp the offset; keep the target until the content is tall enough to hold it.
    pending.current = target;
    scrollRef.current?.scrollTo({ y: target, animated: false });
  }, [tab, topInset]);

  /** Put on the scroll view: retries a restore that the content was too short for. */
  const onContentSizeChange = useCallback(() => {
    const target = pending.current;
    if (target === undefined) return;
    // Still pending until onScroll reports the offset (or the person drags), so a swipe that
    // starts before then keeps the target rather than the old offset.
    scrollRef.current?.scrollTo({ y: target, animated: false });
  }, []);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = event.nativeEvent.contentOffset.y;
    // Reaching the target settles a pending restore.
    if (pending.current !== undefined && Math.abs(offset.current - pending.current) < 2)
      pending.current = undefined;
  }, []);
  /** Put on the scroll view: scrolling by hand drops any restore still waiting. */
  const onScrollBeginDrag = useCallback(() => {
    pending.current = undefined;
    swipeStart.current = undefined;
  }, []);
  /** Put on the pager (SwipePages onSwipeStart), to keep the offset the swipe started from. */
  const onSwipeStart = useCallback(() => {
    // A restore still waiting is where this tab belongs, not the shorter offset it has now.
    swipeStart.current = pending.current ?? offset.current;
  }, []);
  /** Put on the view that holds the tab content, to know where it starts. */
  const onContentLayout = useCallback((event: LayoutChangeEvent) => {
    contentTop.current = event.nativeEvent.layout.y;
  }, []);

  /** Opens `next` at its start next time, whatever was saved ("See all" lands on the top result). */
  const forget = useCallback((next: T) => {
    delete saved.current[next];
  }, []);

  return {
    scrollRef,
    onScroll,
    onScrollBeginDrag,
    onSwipeStart,
    onContentLayout,
    onContentSizeChange,
    forget,
  };
}
