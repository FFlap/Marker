import React from 'react';
import { act, cleanup, renderHook } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { useReducedMotion } from '../../src/hooks/use-reduced-motion';

let emit: (enabled: boolean) => void;
let resolveInitial: (enabled: boolean) => void;
const remove = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  remove.mockClear();
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((_event, listener) => {
    emit = listener;
    return { remove };
  });
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveInitial = resolve;
      }),
  );
});

afterEach(async () => {
  await cleanup();
  jest.restoreAllMocks();
});

it('shares one native listener and removes it only after the final subscriber', async () => {
  expect(AccessibilityInfo.addEventListener).not.toHaveBeenCalled();
  const first = await renderHook(useReducedMotion);
  const second = await renderHook(useReducedMotion);
  expect(AccessibilityInfo.addEventListener).toHaveBeenCalledTimes(1);
  expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalledTimes(1);
  await act(() => resolveInitial(false));
  await act(() => emit(true));
  expect(first.result.current).toBe(true);
  expect(second.result.current).toBe(true);
  await first.unmount();
  expect(remove).not.toHaveBeenCalled();
  await act(() => emit(false));
  expect(second.result.current).toBe(false);
  await second.unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});

it('does not let the initial read overwrite a newer native event', async () => {
  const { result } = await renderHook(useReducedMotion);
  await act(() => emit(true));
  await act(() => resolveInitial(false));
  expect(result.current).toBe(true);
});

it('ignores requests and events belonging to an unsubscribed session', async () => {
  const first = await renderHook(useReducedMotion);
  const staleResolve = resolveInitial;
  const staleEmit = emit;
  await first.unmount();
  const second = await renderHook(useReducedMotion);
  await act(() => resolveInitial(false));
  await act(() => staleResolve(true));
  await act(() => staleEmit(true));
  expect(second.result.current).toBe(false);
});

it('balances native subscriptions under Strict Mode', async () => {
  const view = await renderHook(useReducedMotion, {
    wrapper: ({ children }) => <React.StrictMode>{children}</React.StrictMode>,
  });
  await act(() => resolveInitial(true));
  expect(view.result.current).toBe(true);
  await view.unmount();
  expect(remove.mock.calls.length).toBe(
    jest.mocked(AccessibilityInfo.addEventListener).mock.calls.length,
  );
});
