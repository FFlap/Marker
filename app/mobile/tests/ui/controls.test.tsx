import React from 'react';
import { fireEvent, render, userEvent } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { NativePressable } from '../../src/components/ui/NativePressable';
import { PortalHost } from '@rn-primitives/portal';
import { SeasonPicker } from '../../src/components/SeasonPicker';
import { RatingControl } from '../../src/components/ui/library-controls';

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

  it('stores five-star ratings directly and clears them', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    const view = await render(<RatingControl value={undefined} onChange={onChange} />);
    expect(view.getByLabelText('Current rating').props.accessibilityValue.text).toBe('Not rated');
    await user.press(view.getByLabelText('Rate 3.5 stars'));
    expect(onChange).toHaveBeenLastCalledWith(3.5);
    await view.rerender(<RatingControl value={3.5} onChange={onChange} />);
    expect(view.getByLabelText('Current rating').props.accessibilityValue.text).toBe(
      '3.5 out of 5 stars',
    );
    await user.press(view.getByLabelText('Rate 4 stars'));
    expect(onChange).toHaveBeenLastCalledWith(4);
    await view.rerender(<RatingControl value={4} onChange={onChange} />);
    await user.press(view.getByLabelText('Clear rating'));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it('hides empty seasons before selection and keeps specials with episodes', async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    const view = await render(
      <>
        <SeasonPicker
          open
          value={1}
          options={[
            { season: 0, name: 'Specials', episodeCount: 2 },
            { season: 1, episodeCount: 12 },
            { season: 2, episodeCount: 0 },
          ]}
          onOpenChange={jest.fn()}
          onChange={onChange}
        />
        <PortalHost />
      </>,
    );
    expect(view.queryByLabelText('Select Season 2')).toBeNull();
    await user.press(view.getByLabelText('Select Specials'));
    expect(onChange).toHaveBeenCalledWith(0);
  });
});
