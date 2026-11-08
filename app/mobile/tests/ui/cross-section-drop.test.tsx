import { act, renderHook } from '@testing-library/react-native';
import { useCrossSectionDrop } from '@/hooks/use-cross-section-drop';

describe('cross-section insertion', () => {
  it('uses window geometry to find the destination and insertion slot after scrolling', async () => {
    const { result } = await renderHook(useCrossSectionDrop);
    const watched = jest.fn(() => ({ index: 1, distance: 0 }));
    result.current.targets.current.watched = watched;
    result.current.targets.current.watching = () => ({ index: 3, distance: 180 });
    let status;
    await act(() => {
      status = result.current.update('watching', 140, 300, 620);
    });
    expect(watched).toHaveBeenCalledWith(140, 300, 620);
    expect(status).toBe('watched');
    expect(result.current.index).toBe(1);
    expect(result.current.indexRef.current).toBe(1);
    await act(() => result.current.clear());
    expect(result.current.index).toBeUndefined();
    expect(result.current.indexRef.current).toBeUndefined();
  });

  it('keeps an empty destination available and remembers placement for confirmation', async () => {
    const { result } = await renderHook(useCrossSectionDrop);
    await act(() => {
      result.current.update('watched', 40, 200, 0);
      result.current.pendingIndex.current = result.current.indexRef.current;
      result.current.clear();
    });
    expect(result.current.index).toBeUndefined();
    expect(result.current.pendingIndex.current).toBe(0);
  });
});

it('rejects an unmeasured nonempty target without losing a measured first slot', async () => {
  const { result } = await renderHook(useCrossSectionDrop);
  result.current.targets.current.watched = () => ({ index: 0, distance: Number.POSITIVE_INFINITY });
  let status;
  await act(() => {
    status = result.current.update('watched', 40, 200, 0);
  });
  expect(status).toBeUndefined();
  expect(result.current.indexRef.current).toBeUndefined();
  result.current.targets.current.watched = () => ({ index: 0, distance: 0 });
  await act(() => {
    status = result.current.update('watched', 40, 200, 0);
  });
  expect(status).toBe('watched');
  expect(result.current.indexRef.current).toBe(0);
});

it('prefers the section under the pointer when an earlier grid still reports overlapping bounds', async () => {
  const { result } = await renderHook(useCrossSectionDrop);
  result.current.targets.current.watched = () => ({ index: 2, distance: 0 });
  result.current.targets.current.watching = () => ({ index: 1, distance: 0 });
  let status;
  await act(() => {
    status = result.current.update('watching', 140, 300, 0);
  });
  expect(status).toBe('watching');
  expect(result.current.indexRef.current).toBe(1);
});
