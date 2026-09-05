import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('../../src/components/ui/drawer', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');
  const DrawerContext = React.createContext({ open: false });
  const drawer = ({
    children,
    onOpenChange,
    open,
  }: {
    children: React.ReactNode;
    onOpenChange?: (open: boolean) => void;
    open?: boolean;
  }) => (
    <DrawerContext.Provider value={{ open: open === true }}>
      <View>
        {children}
        {open === true && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss drawer"
            onPress={() => onOpenChange?.(false)}
          />
        )}
      </View>
    </DrawerContext.Provider>
  );
  const container = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  const content = ({ children }: { children: React.ReactNode }) =>
    React.useContext(DrawerContext).open ? <View>{children}</View> : null;
  const label = ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>;
  return {
    Drawer: drawer,
    DrawerClose: container,
    DrawerContent: content,
    DrawerHeader: container,
    DrawerTitle: label,
  };
});

import {
  LibraryEntryDrawer,
  type LibraryEntryDraft,
} from '../../src/components/LibraryEntryDrawer';

const initial: LibraryEntryDraft = {
  status: 'watching',
  rating: undefined,
  timesWatched: 0,
  tags: [],
};

describe('library entry drawer', () => {
  it('does not add an entry when the add drawer is dismissed', async () => {
    const onSubmit = jest.fn();
    const view = await render(
      <LibraryEntryDrawer
        open
        onOpenChange={jest.fn()}
        mode="add"
        initial={initial}
        suggestions={[]}
        saving={false}
        onSubmit={onSubmit}
      />,
    );

    await fireEvent.press(view.getByRole('button', { name: 'Dismiss drawer' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('only shows times watched for Watched entries and increments the count', async () => {
    const onSubmit = jest.fn();
    const view = await render(
      <LibraryEntryDrawer
        open
        onOpenChange={jest.fn()}
        mode="update"
        initial={{ ...initial, status: 'watched', timesWatched: 1 }}
        suggestions={[]}
        saving={false}
        onSubmit={onSubmit}
      />,
    );

    expect(view.queryByLabelText('Increase times watched')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('Increase times watched'));
    await fireEvent.press(view.getByRole('button', { name: 'Dismiss drawer' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'watched', timesWatched: 2 }),
    );
  });

  it('sets the count to one and explains the episode impact when Watched is selected', async () => {
    const onSubmit = jest.fn();
    const view = await render(
      <LibraryEntryDrawer
        open
        onOpenChange={jest.fn()}
        mode="update"
        initial={{ ...initial, status: 'watchlist' }}
        suggestions={[]}
        saving={false}
        onSubmit={onSubmit}
        watchedHint="Marking this show as Watched will mark every episode as watched."
      />,
    );

    expect(view.queryByLabelText('Increase times watched')).toBeNull();
    await fireEvent.press(view.getByText('Watched', { exact: true }));
    expect(view.getByLabelText('Increase times watched')).toBeTruthy();
    expect(
      view.getByText('Marking this show as Watched will mark every episode as watched.'),
    ).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: 'Dismiss drawer' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'watched', timesWatched: 1 }),
    );
  });

  it('resets an abandoned draft when the drawer is reopened', async () => {
    const onSubmit = jest.fn();
    const props = {
      mode: 'update' as const,
      initial: { ...initial, status: 'watched' as const, timesWatched: 1 },
      suggestions: [],
      saving: false,
      onSubmit,
      onOpenChange: jest.fn(),
    };
    const view = await render(<LibraryEntryDrawer {...props} open />);

    await fireEvent.press(view.getByLabelText('Increase times watched'));
    await view.rerender(<LibraryEntryDrawer {...props} open={false} />);
    await view.rerender(<LibraryEntryDrawer {...props} open />);
    await fireEvent.press(view.getByRole('button', { name: 'Dismiss drawer' }));

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
