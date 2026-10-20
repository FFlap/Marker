import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { WatchHeatmap } from '../../src/components/WatchHeatmap';

it('updates the selected day when reactive watch counts change', async () => {
  const date = '2026-10-10';
  const view = await render(<WatchHeatmap days={[{ date, episodes: 1 }]} today={date} />);
  const container = view.getByTestId('watch-activity-heatmap');
  await fireEvent(container, 'layout', { nativeEvent: { layout: { width: 102 } } });
  await fireEvent.press(view.getByRole('image'), {
    nativeEvent: { locationX: 96, locationY: 96 },
  });
  expect(view.getByText('1 episode · Oct 10, 2026')).toBeTruthy();

  await view.rerender(<WatchHeatmap days={[{ date, episodes: 5 }]} today={date} />);
  expect(view.getByText('5 episodes · Oct 10, 2026')).toBeTruthy();
  await view.rerender(<WatchHeatmap days={[]} today={date} />);
  expect(view.getByText('0 episodes · Oct 10, 2026')).toBeTruthy();
});
