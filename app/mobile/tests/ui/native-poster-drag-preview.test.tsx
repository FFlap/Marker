import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import {
  clampNativePosterTop,
  NativePosterDragPreview,
} from '@/components/NativePosterDragPreview';

jest.mock('expo-image', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    Image: (props: object) => React.createElement(View, { ...props, testID: 'preview-image' }),
  };
});

function Preview({
  onReady,
  kind = 'poster',
}: {
  onReady: () => void;
  kind?: 'poster' | 'missing' | 'list';
}) {
  const isTouchActiveNative = useSharedValue(true);
  const touchTranslate = useSharedValue(0);
  return (
    <NativePosterDragPreview
      layout={{ height: 150, left: 0, top: 0, width: 100 }}
      motion={{ isTouchActiveNative, touchTranslate, onPreviewReady: onReady }}
      posterPath={kind === 'missing' ? undefined : '/poster.jpg'}
      title="Example Title"
    >
      {kind === 'list' && <Text>Example row</Text>}
    </NativePosterDragPreview>
  );
}

describe('NativePosterDragPreview', () => {
  it('keeps the carried poster below the header and above the bottom boundary', () => {
    const bounds = { top: 60, bottom: 700 };
    expect(clampNativePosterTop(-100, 190, bounds)).toBe(60);
    expect(clampNativePosterTop(300, 190, bounds)).toBe(300);
    expect(clampNativePosterTop(650, 190, bounds)).toBe(510);
    expect(clampNativePosterTop(-100, 190, bounds, 1.025)).toBeCloseTo(62.375);
  });

  it('waits for a displayed poster and acknowledges readiness only once', async () => {
    const onReady = jest.fn();
    const screen = await render(<Preview onReady={onReady} />);
    const preview = () => screen.root!;
    expect(StyleSheet.flatten(preview().props.style).opacity).toBe(0);
    await fireEvent(screen.getByTestId('preview-image', { includeHiddenElements: true }), 'load');
    expect(onReady).not.toHaveBeenCalled();
    await fireEvent(
      screen.getByTestId('preview-image', { includeHiddenElements: true }),
      'display',
    );
    expect(StyleSheet.flatten(preview().props.style).opacity).toBe(1);
    await fireEvent(
      screen.getByTestId('preview-image', { includeHiddenElements: true }),
      'display',
    );
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('reveals a usable fallback when the poster cannot load', async () => {
    const onReady = jest.fn();
    const screen = await render(<Preview onReady={onReady} />);
    await fireEvent(screen.getByTestId('preview-image', { includeHiddenElements: true }), 'error', {
      error: 'Image unavailable',
    });
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(screen.getByText('ET', { includeHiddenElements: true })).toBeTruthy();
    expect(StyleSheet.flatten(screen.root!.props.style).opacity).toBe(1);
  });

  it.each(['missing', 'list'] as const)('reveals the %s preview after layout', async (kind) => {
    const onReady = jest.fn();
    const screen = await render(<Preview onReady={onReady} kind={kind} />);
    const preview = screen.root!;
    await fireEvent(preview, 'layout');
    await fireEvent(preview, 'layout');
    expect(onReady).toHaveBeenCalledTimes(1);
  });
});
