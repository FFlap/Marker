import { act, cleanup, renderHook } from '@testing-library/react-native';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { useTabScrollMemory } from '../../src/hooks/use-tab-scroll-memory';

afterEach(async () => {
  await cleanup();
});

const scrolled = (y: number) =>
  ({ nativeEvent: { contentOffset: { x: 0, y } } }) as NativeSyntheticEvent<NativeScrollEvent>;
const laidOut = (y: number, height = 0) =>
  ({ nativeEvent: { layout: { x: 0, y, width: 400, height } } }) as LayoutChangeEvent;

async function setup() {
  const scrollTo = jest.fn();
  const hook = await renderHook(
    ({ tab }: { tab: 'a' | 'b' }) => {
      const memory = useTabScrollMemory(tab);
      memory.scrollRef.current = { scrollTo } as never;
      return memory;
    },
    { initialProps: { tab: 'a' } },
  );
  await act(() => {
    hook.result.current.onContentLayout(laidOut(200));
  });
  return { ...hook, scrollTo };
}

it('restores where a swipe started, not the offset the shrinking pager clamped to', async () => {
  const { result, rerender, scrollTo } = await setup();
  await act(() => result.current.onScroll(scrolled(1500)));
  await act(() => {
    result.current.onSwipeStart();
    // The next page is shorter, so the scroll view clamps while the swipe is still moving.
    result.current.onScroll(scrolled(600));
  });
  await rerender({ tab: 'b' });
  await act(() => result.current.onScroll(scrolled(200)));
  scrollTo.mockClear();
  await rerender({ tab: 'a' });
  expect(scrollTo).toHaveBeenLastCalledWith({ y: 1500, animated: false });
});

it('drops a waiting restore once the person scrolls by hand', async () => {
  const { result, rerender, scrollTo } = await setup();
  await act(() => result.current.onScroll(scrolled(1500)));
  await rerender({ tab: 'b' });
  await act(() => result.current.onScroll(scrolled(200)));
  await rerender({ tab: 'a' });
  // Still too short for 1500: the restore waits for the content to grow.
  await act(() => result.current.onContentSizeChange(400, 1200));
  await act(() => result.current.onScrollBeginDrag());
  scrollTo.mockClear();
  await act(() => result.current.onContentSizeChange(400, 3000));
  expect(scrollTo).not.toHaveBeenCalled();
});

it('replaces a waiting restore when the tab changes again', async () => {
  const { result, rerender, scrollTo } = await setup();
  await act(() => result.current.onScroll(scrolled(1500)));
  await rerender({ tab: 'b' });
  await act(() => result.current.onScroll(scrolled(200)));
  await rerender({ tab: 'a' });
  await act(() => result.current.onContentSizeChange(400, 1200));
  // Back to b before a's restore could land: b is where the offset already is.
  await rerender({ tab: 'b' });
  scrollTo.mockClear();
  await act(() => result.current.onContentSizeChange(400, 3000));
  expect(scrollTo).not.toHaveBeenCalled();
});

it('keeps a restore that has not landed when the tab is swiped away again', async () => {
  const { result, rerender, scrollTo } = await setup();
  await act(() => result.current.onScroll(scrolled(1500)));
  await rerender({ tab: 'b' });
  await act(() => result.current.onScroll(scrolled(200)));
  await rerender({ tab: 'a' });
  // The content only allows 600 so far, and the person swipes back to b.
  await act(() => {
    result.current.onScroll(scrolled(600));
    result.current.onSwipeStart();
  });
  await rerender({ tab: 'b' });
  scrollTo.mockClear();
  await rerender({ tab: 'a' });
  expect(scrollTo).toHaveBeenLastCalledWith({ y: 1500, animated: false });
});

it('keeps the target when a swipe starts after the content grew but before the scroll lands', async () => {
  const { result, rerender, scrollTo } = await setup();
  await act(() => result.current.onScroll(scrolled(1500)));
  await rerender({ tab: 'b' });
  await act(() => result.current.onScroll(scrolled(200)));
  await rerender({ tab: 'a' });
  // Tall enough now; the scroll to 1500 is issued but hasn't been reported yet.
  await act(() => {
    result.current.onContentSizeChange(400, 3000);
    result.current.onSwipeStart();
  });
  await rerender({ tab: 'b' });
  scrollTo.mockClear();
  await rerender({ tab: 'a' });
  expect(scrollTo).toHaveBeenLastCalledWith({ y: 1500, animated: false });
});
