import React from 'react';
import { fireEvent, render, userEvent } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { PortalHost } from '@rn-primitives/portal';
import { SeasonPicker } from '../../src/components/SeasonPicker';
import { RatingControl } from '../../src/components/ui/library-controls';
import { Button, Chip, Segmented } from '../../src/components/ui/primitives';
import { NativePressable } from '../../src/components/ui/NativePressable';

jest.mock('expo-image', () => ({ Image: require('react-native').Image }));

describe('shared controls', () => {
  it('keeps native Pressable styles concrete while applying pressed feedback', async () => {
    const view = await render(
      <NativePressable
        accessibilityLabel="Native action"
        style={{ minHeight: 44, backgroundColor: '#111113' }}
        pressedStyle={{ opacity: 0.6 }}
      />,
    );
    const pressable = view.getByLabelText('Native action');

    expect(typeof pressable.props.style).not.toBe('function');
    expect(StyleSheet.flatten(pressable.props.style)).toMatchObject({
      minHeight: 44,
      backgroundColor: '#111113',
    });

    await fireEvent(pressable, 'pressIn', { nativeEvent: {} });
    expect(StyleSheet.flatten(pressable.props.style)).toMatchObject({ opacity: 0.6 });
    await fireEvent(pressable, 'pressOut', { nativeEvent: {} });
  });

  it('passes concrete native styles to buttons so their touch target and surface render', async () => {
    const view = await render(<Button title="Continue" onPress={jest.fn()} />);
    const button = view.getByLabelText('Continue');

    expect(typeof button.props.style).not.toBe('function');
    expect(StyleSheet.flatten(button.props.style)).toMatchObject({
      height: 46,
      borderWidth: 1,
      backgroundColor: '#F4F4F5',
    });
  });

  it('keeps compact shared controls at least 44 points tall', async () => {
    const view = await render(
      <>
        <Chip label="Watching" onPress={jest.fn()} />
        <Segmented
          options={[
            { label: 'List', value: 'list' },
            { label: 'Posters', value: 'posters' },
          ]}
          value="list"
          onChange={jest.fn()}
        />
      </>,
    );

    expect(StyleSheet.flatten(view.getByLabelText('Watching').props.style)).toMatchObject({
      minHeight: 44,
    });
    expect(StyleSheet.flatten(view.getByText('List').parent?.props.style)).toMatchObject({
      minHeight: 44,
    });
  });

  it('maps a five-star rating onto the stored ten-point scale and clears it', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    const view = await render(<RatingControl value={undefined} onChange={onChange} />);
    expect(view.getByLabelText('Current rating').props.accessibilityValue.text).toBe('Not rated');
    await user.press(view.getByLabelText('Rate 3.5 stars'));
    expect(onChange).toHaveBeenLastCalledWith(7);
    await view.rerender(<RatingControl value={7} onChange={onChange} />);
    expect(view.getByLabelText('Current rating').props.accessibilityValue.text).toBe(
      '3.5 out of 5 stars',
    );
    await user.press(view.getByLabelText('Rate 4 stars'));
    expect(onChange).toHaveBeenLastCalledWith(8);
    await view.rerender(<RatingControl value={8} onChange={onChange} />);
    await user.press(view.getByLabelText('Clear rating'));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it('mounts every option in a constrained long season menu', async () => {
    const view = await render(
      <>
        <SeasonPicker
          open
          value={1}
          options={Array.from({ length: 20 }, (_, index) => ({
            season: index + 1,
            name: `Season ${index + 1}`,
            episodeCount: 12,
          }))}
          onOpenChange={jest.fn()}
          onChange={jest.fn()}
        />
        <PortalHost />
      </>,
    );

    const list = view.getByLabelText('Season options');
    expect(StyleSheet.flatten(list.props.style)).toMatchObject({ flex: 1 });
    expect(view.getByLabelText('Select Season 1')).toBeTruthy();
    expect(view.getByLabelText('Select Season 20')).toBeTruthy();
  });
});
