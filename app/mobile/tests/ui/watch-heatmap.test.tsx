import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { WatchHeatmap } from '../../src/components/WatchHeatmap';

it('updates the selected day when reactive watch counts change', async () => {
  const date = '2026-10-10';
  const view = await render(<WatchHeatmap days={[{ date, episodes: 1 }]} today={date} />);
  const container = view.getByTestId('watch-activity-heatmap');
  await fireEvent(container, 'layout', { nativeEvent: { layout: { width: 102 } } });
  await fireEvent.press(view.getByRole('adjustable'), {
    nativeEvent: { locationX: 96, locationY: 96 },
  });
  expect(view.getByText('1 episode · Oct 10, 2026')).toBeTruthy();

  await view.rerender(<WatchHeatmap days={[{ date, episodes: 5 }]} today={date} />);
  expect(view.getByText('5 episodes · Oct 10, 2026')).toBeTruthy();
  await view.rerender(<WatchHeatmap days={[]} today={date} />);
  expect(view.getByText('0 episodes · Oct 10, 2026')).toBeTruthy();
});

it('lets screen readers inspect dates without touch coordinates and stays within the grid', async () => {
  const view = await render(
    <WatchHeatmap days={[{ date: '2026-10-09', episodes: 2 }]} today="2026-10-10" />,
  );
  await fireEvent(view.getByTestId('watch-activity-heatmap'), 'layout', {
    nativeEvent: { layout: { width: 12 } },
  });
  const adjust = (actionName: string) =>
    fireEvent(view.getByRole('adjustable'), 'accessibilityAction', {
      nativeEvent: { actionName },
    });
  expect(view.getByRole('adjustable').props.accessibilityValue.text).toBe(
    '0 episodes on Oct 10, 2026',
  );
  await adjust('decrement');
  expect(view.getByRole('adjustable').props.accessibilityValue.text).toBe(
    '2 episodes on Oct 9, 2026',
  );
  expect(view.getByText('2 episodes · Oct 9, 2026')).toBeTruthy();
  for (let index = 0; index < 10; index += 1) await adjust('decrement');
  expect(view.getByRole('adjustable').props.accessibilityValue.text).toBe(
    '0 episodes on Oct 4, 2026',
  );
  for (let index = 0; index < 10; index += 1) await adjust('increment');
  expect(view.getByRole('adjustable').props.accessibilityValue.text).toBe(
    '0 episodes on Oct 10, 2026',
  );
  await view.rerender(
    <WatchHeatmap days={[{ date: '2026-10-10', episodes: 5 }]} today="2026-10-10" />,
  );
  expect(view.getByRole('adjustable').props.accessibilityValue.text).toBe(
    '5 episodes on Oct 10, 2026',
  );
});

it('drops an out-of-range selection after resizing or advancing to a new week', async () => {
  const view = await render(<WatchHeatmap days={[]} today="2026-10-10" />);
  const layout = (width: number) =>
    fireEvent(view.getByTestId('watch-activity-heatmap'), 'layout', {
      nativeEvent: { layout: { width } },
    });
  await layout(102);
  await fireEvent.press(view.getByRole('adjustable'), {
    nativeEvent: { locationX: 1, locationY: 1 },
  });
  expect(view.getByText('0 episodes · Aug 23, 2026')).toBeTruthy();
  await layout(12);
  expect(view.getByText('0 episodes in the last 1 week')).toBeTruthy();
  expect(view.getByRole('adjustable').props.accessibilityValue.text).toBe(
    '0 episodes on Oct 10, 2026',
  );
  await fireEvent.press(view.getByRole('adjustable'), {
    nativeEvent: { locationX: 1, locationY: 1 },
  });
  await view.rerender(<WatchHeatmap days={[]} today="2026-10-11" />);
  expect(view.getByRole('adjustable').props.accessibilityValue.text).toBe(
    '0 episodes on Oct 11, 2026',
  );
});
