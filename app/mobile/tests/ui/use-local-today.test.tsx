import { act, cleanup, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { localDateKey, useLocalToday } from '../../src/hooks/use-local-today';

afterEach(async () => {
  await cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// Also run with TZ=America/Edmonton to exercise 23-hour and 25-hour local days.
it.each([
  [2, 8],
  [10, 1],
])('updates at local midnight through DST (%s/%s)', async (month, day) => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
  const start = new Date(2026, month, day);
  const next = new Date(2026, month, day + 1);
  jest.setSystemTime(start);
  const { result, unmount } = await renderHook(useLocalToday);
  expect(result.current).toBe(localDateKey(start));
  await act(() => jest.advanceTimersByTime(next.getTime() - start.getTime() - 1));
  expect(result.current).toBe(localDateKey(start));
  await act(() => jest.advanceTimersByTime(101));
  expect(result.current).toBe(localDateKey(next));
  await unmount();
  expect(jest.getTimerCount()).toBe(0);
});

it('refreshes on foreground after a clock change and removes its subscription', async () => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
  jest.setSystemTime(new Date(2026, 9, 10, 12));
  let onChange: (state: AppStateStatus) => void = () => undefined;
  const remove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    onChange = listener;
    return { remove };
  });
  const { result, unmount } = await renderHook(useLocalToday);
  jest.setSystemTime(new Date(2026, 9, 12, 12));
  await act(() => onChange('background'));
  expect(result.current).toBe('2026-10-10');
  await act(() => onChange('active'));
  expect(result.current).toBe('2026-10-12');
  expect(jest.getTimerCount()).toBe(1);
  await act(() => onChange('active'));
  expect(jest.getTimerCount()).toBe(1);
  await unmount();
  expect(jest.getTimerCount()).toBe(0);
  expect(remove).toHaveBeenCalledTimes(1);
});
