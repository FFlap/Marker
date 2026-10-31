import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { PortalHost } from '@rn-primitives/portal';
import {
  LibraryEntryDrawer,
  type LibraryEntryDraft,
} from '../../src/components/LibraryEntryDrawer';

jest.mock('react-native-screens', () => ({
  FullWindowOverlay: ({ children }: { children: React.ReactNode }) => children,
}));

const initial: LibraryEntryDraft = { status: 'watchlist', timesWatched: 0, tags: [] };

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it('preserves edits through refreshes and exit animation, then resets on reopening', async () => {
  const onSubmit = jest.fn();
  const onOpenChange = jest.fn();
  const drawer = (open: boolean, draft = initial) => (
    <>
      <LibraryEntryDrawer
        open={open}
        mode="update"
        initial={draft}
        suggestions={[]}
        saving={false}
        onSubmit={onSubmit}
        onOpenChange={onOpenChange}
      />
      <PortalHost />
    </>
  );
  const view = await render(drawer(true));
  await fireEvent.press(view.getByText('Watched'));
  await fireEvent.changeText(view.getByPlaceholderText('Add a tag'), 'unsaved search');
  await view.rerender(drawer(true, { ...initial, tags: ['server refresh'] }));
  expect(view.getByText('Times watched')).toBeTruthy();
  expect(view.getByPlaceholderText('Add a tag').props.value).toBe('unsaved search');

  await fireEvent.press(view.getByText('Done'));
  expect(onSubmit).not.toHaveBeenCalled();
  await act(() => jest.advanceTimersByTime(200));
  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(onSubmit).toHaveBeenLastCalledWith({ status: 'watched', timesWatched: 1, tags: [] });
  expect(onOpenChange).toHaveBeenCalledWith(false);

  await view.rerender(drawer(false));
  await view.rerender(drawer(true, { ...initial, tags: ['fresh'] }));
  expect(view.queryByText('Times watched')).toBeNull();
  expect(view.getByText('fresh')).toBeTruthy();
  expect(view.getByPlaceholderText('Add a tag').props.value).toBe('');
  await fireEvent.press(view.getByText('Dropped'));
  await fireEvent.press(view.getByText('Done'));
  await act(() => jest.advanceTimersByTime(200));
  expect(onSubmit).toHaveBeenCalledTimes(2);
  expect(onSubmit).toHaveBeenLastCalledWith({ ...initial, status: 'dropped', tags: ['fresh'] });
});

it('cancels a pending close when its editing session is replaced', async () => {
  const onSubmit = jest.fn();
  const onOpenChange = jest.fn();
  const drawer = (open: boolean) => (
    <>
      <LibraryEntryDrawer
        open={open}
        mode="update"
        initial={initial}
        suggestions={[]}
        saving={false}
        onSubmit={onSubmit}
        onOpenChange={onOpenChange}
      />
      <PortalHost />
    </>
  );
  const view = await render(drawer(true));
  await fireEvent.press(view.getByText('Watched'));
  await fireEvent.press(view.getByText('Done'));
  await view.rerender(drawer(false));
  await view.rerender(drawer(true));
  await act(() => jest.advanceTimersByTime(200));
  expect(onSubmit).not.toHaveBeenCalled();
  expect(onOpenChange).not.toHaveBeenCalled();
  expect(view.queryByText('Times watched')).toBeNull();
});
