import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockUpcoming = jest.fn().mockResolvedValue({
  events: [],
  failedTitles: { count: 0, names: [] },
});
let mockDate = '';

jest.mock('convex/react', () => ({
  useQuery: () => [],
  useMutation: () => jest.fn().mockResolvedValue(undefined),
  useAction: () => mockUpcoming,
}));
jest.mock('../../convex/_generated/api', () => ({
  api: {
    profiles: { followRequests: 'followRequests', respondToFollow: 'respondToFollow' },
    notifications: { feed: 'notificationsFeed' },
    calendar: { upcoming: 'calendarUpcoming' },
  },
}));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn(), canGoBack: () => true },
  useLocalSearchParams: () => ({ date: mockDate }),
}));
jest.mock('expo-image', () => ({ Image: require('react-native').Image }));

import CalendarScreen from '../../src/app/calendar';
import CalendarDayScreen from '../../src/app/calendar/[date]';
import NotificationsScreen from '../../src/app/notifications';

describe('secondary mobile pages', () => {
  beforeEach(() => {
    mockUpcoming.mockClear();
    mockUpcoming.mockResolvedValue({ events: [], failedTitles: { count: 0, names: [] } });
    mockDate = '';
  });

  it('shows native back navigation on Notifications', async () => {
    const view = await render(<NotificationsScreen />);
    expect(view.getByLabelText('Back to library')).toBeTruthy();
  });

  it('shows native back navigation on Calendar', async () => {
    const view = await render(<CalendarScreen />);
    expect(view.getByLabelText('Back to library')).toBeTruthy();
    await waitFor(() => expect(mockUpcoming).toHaveBeenCalled());
  });

  it('lists releases inside calendar days and summarizes overflow', async () => {
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    mockUpcoming.mockResolvedValueOnce({
      failedTitles: { count: 0, names: [] },
      events: [
        { id: 'one', date, kind: 'episode', title: 'Severance', season: 3, episode: 2 },
        { id: 'two', date, kind: 'episode', title: 'Shōgun', season: 2, episode: 1 },
        { id: 'three', date, kind: 'movie', title: 'Perfect Days' },
        { id: 'four', date, kind: 'episode', title: 'Andor', season: 2, episode: 7 },
        { id: 'five', date, kind: 'episode', title: 'The Bear', season: 5, episode: 3 },
        { id: 'six', date, kind: 'episode', title: 'Slow Horses', season: 6, episode: 2 },
        { id: 'seven', date, kind: 'movie', title: 'Mickey 17' },
        { id: 'eight', date, kind: 'episode', title: 'Poker Face', season: 3, episode: 5 },
      ],
    });

    const view = await render(<CalendarScreen />);
    await waitFor(() => expect(view.getByText('Severance')).toBeTruthy());
    expect(view.getByText(/^\+\d+ more$/)).toBeTruthy();
    fireEvent.press(view.getByLabelText(/8 releases/));
    expect(jest.requireMock('expo-router').router.push).toHaveBeenCalledWith({
      pathname: '/calendar/[date]',
      params: { date },
    });
  });

  it('shows the complete schedule on the selected day screen', async () => {
    const today = new Date();
    mockDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    mockUpcoming.mockResolvedValueOnce({
      failedTitles: { count: 0, names: [] },
      events: [
        {
          id: 'one',
          date: mockDate,
          kind: 'episode',
          title: 'Severance',
          season: 3,
          episode: 2,
          episodeName: 'The After Hours',
        },
        { id: 'two', date: mockDate, kind: 'movie', title: 'Perfect Days' },
      ],
    });

    const view = await render(<CalendarDayScreen />);
    await waitFor(() => expect(view.getByText('Severance')).toBeTruthy());
    expect(view.getByText('The After Hours')).toBeTruthy();
    expect(view.getByText('Season 3 · Episode 2')).toBeTruthy();
    expect(view.getByText('Perfect Days')).toBeTruthy();
    expect(view.getByText('Movie release')).toBeTruthy();
  });

  it('surfaces a partial calendar result without hiding loaded releases', async () => {
    mockUpcoming.mockResolvedValueOnce({
      events: [],
      failedTitles: { count: 1, names: ['Broken title'] },
    });
    const view = await render(<CalendarScreen />);
    await waitFor(() => expect(view.getByText('Some titles could not be loaded.')).toBeTruthy());
  });
});
