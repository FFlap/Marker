import React from 'react';
import { AppState } from 'react-native';
import { fireEvent, render as renderNative, waitFor, act } from '@testing-library/react-native';

const mockUpcoming = jest.fn().mockResolvedValue({
  events: [],
  failedTitles: { count: 0, names: [] },
});
let mockDate = '';
let mockFocused = true;
let mockLibraryRevision: number | undefined = 0;

jest.mock('convex/react', () => ({
  useQuery: (query: string) => (query === 'calendarRevision' ? mockLibraryRevision : []),
  useMutation: () => jest.fn().mockResolvedValue(undefined),
  useAction: () => mockUpcoming,
}));
jest.mock('../../convex/_generated/api', () => ({
  api: {
    profiles: { followRequests: 'followRequests', respondToFollow: 'respondToFollow' },
    notifications: { feed: 'notificationsFeed' },
    calendar: { upcomingPage: 'calendarUpcoming' },
    calendarLibrary: { revision: 'calendarRevision' },
  },
}));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn(), canGoBack: () => true },
  useLocalSearchParams: () => ({ date: mockDate }),
  useFocusEffect: (effect: () => (() => void) | undefined) => {
    require('react').useEffect(() => (mockFocused ? effect() : undefined), [effect, mockFocused]);
  },
}));
jest.mock('expo-image', () => ({ Image: require('react-native').Image }));

import { CalendarProvider } from '../../src/hooks/useCalendar';
const render = (ui: React.ReactElement) => renderNative(ui, { wrapper: CalendarProvider });

import CalendarScreen from '../../src/app/calendar';
import CalendarDayScreen from '../../src/app/calendar/[date]';

describe('secondary mobile pages', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 8, 1, 12));
    mockUpcoming.mockClear();
    mockUpcoming.mockResolvedValue({ events: [], failedTitles: { count: 0, names: [] } });
    mockDate = '';
    mockFocused = true;
    mockLibraryRevision = 0;
  });
  afterEach(() => jest.spyOn(Date, 'now').mockRestore());

  it('refreshes a cached day immediately after a library revision changes', async () => {
    mockDate = '2026-09-02';
    mockUpcoming.mockResolvedValue({
      events: [{ id: 'removed', date: mockDate, kind: 'movie', title: 'Removed title' }],
      failedTitles: { count: 0, names: [] },
    });
    const view = await render(<CalendarDayScreen />);
    await waitFor(() => expect(view.getByText('Removed title')).toBeTruthy());
    mockUpcoming.mockResolvedValue({
      events: [{ id: 'new', date: mockDate, kind: 'movie', title: 'Added title' }],
      failedTitles: { count: 0, names: [] },
    });
    mockLibraryRevision = 1;
    await view.rerender(<CalendarDayScreen />);
    await waitFor(() => expect(view.getByText('Added title')).toBeTruthy());
    expect(view.queryByText('Removed title')).toBeNull();
    expect(mockUpcoming).toHaveBeenCalledTimes(2);
  });

  it('waits for the library revision before warming a calendar', async () => {
    mockDate = '2026-09-02';
    mockLibraryRevision = undefined;
    const view = await render(<CalendarDayScreen />);
    expect(mockUpcoming).not.toHaveBeenCalled();
    mockLibraryRevision = 0;
    await view.rerender(<CalendarDayScreen />);
    await waitFor(() => expect(mockUpcoming).toHaveBeenCalledTimes(1));
  });

  it('lists releases inside calendar days and summarizes overflow', async () => {
    const today = new Date(Date.now());
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
    await waitFor(() => expect(view.getByText('Andor')).toBeTruthy());
    expect(view.getByText(/^\+\d+ more$/)).toBeTruthy();
    await fireEvent.press(view.getByLabelText(/8 releases/));
    expect(jest.requireMock('expo-router').router.push).toHaveBeenCalledWith({
      pathname: '/calendar/[date]',
      params: { date },
    });
    mockDate = date;
    await view.rerender(<CalendarDayScreen />);
    expect(view.getByText('Severance')).toBeTruthy();
    expect(view.getByText('Season 3 · Episode 2')).toBeTruthy();
    expect(view.getByText('Poker Face')).toBeTruthy();
    expect(view.queryByText('No releases')).toBeNull();
    expect(
      mockUpcoming.mock.calls.filter(([args]) => args.startDate.slice(0, 7) === date.slice(0, 7)),
    ).toHaveLength(1);
  });

  it('shows saved releases in the month and day while background updates are pending', async () => {
    const saved = {
      events: [
        {
          id: 'saved',
          date: '2026-09-02',
          kind: 'episode',
          title: 'Saved show',
          season: 1,
          episode: 2,
        },
      ],
      failedTitles: { count: 0, names: [] },
      needsRefresh: true,
    };
    let finish!: (value: object) => void;
    mockUpcoming.mockResolvedValueOnce(saved).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = await render(<CalendarScreen />);
    await waitFor(() => expect(view.getByText('Updating release dates…')).toBeTruthy());
    expect(view.getByText('Saved show')).toBeTruthy();
    mockDate = '2026-09-02';
    await view.rerender(<CalendarDayScreen />);
    expect(view.getByText('Updating release dates…')).toBeTruthy();
    expect(view.getByText('Season 1 · Episode 2')).toBeTruthy();
    expect(mockUpcoming).toHaveBeenCalledTimes(2);
    await act(async () => finish({ events: [], failedTitles: { count: 0, names: [] } }));
    await waitFor(() => expect(view.queryByText('Updating release dates…')).toBeNull());
    expect(view.queryByText('Saved show')).toBeNull();
    expect(view.getByText('No releases')).toBeTruthy();
  });

  it('surfaces a partial calendar result without hiding loaded releases', async () => {
    mockUpcoming.mockResolvedValueOnce({
      events: [],
      failedTitles: { count: 1, names: ['Broken title'] },
    });
    const view = await render(<CalendarScreen />);
    await waitFor(() => expect(view.getByText(/Some titles could not be loaded/)).toBeTruthy());
  });

  it('clears a failed month when navigating to a different month', async () => {
    mockDate = '2026-09-01';
    mockUpcoming.mockRejectedValueOnce(new Error('offline'));
    const view = await render(<CalendarDayScreen />);
    await waitFor(() => expect(view.getByText(/Couldn’t load this day/)).toBeTruthy());
    mockDate = '2026-10-02';
    mockUpcoming.mockResolvedValueOnce({
      events: [{ id: 'release', date: mockDate, kind: 'movie', title: 'Arrival' }],
      failedTitles: { count: 0, names: [] },
    });
    await view.rerender(<CalendarDayScreen />);
    await waitFor(() => expect(view.getByText('Arrival')).toBeTruthy());
    expect(view.queryByText(/Couldn’t load this day/)).toBeNull();
  });
  it('shares releases with day details without a second request', async () => {
    mockDate = '2026-09-02';
    mockUpcoming.mockResolvedValue({
      events: [
        {
          id: 'release',
          date: mockDate,
          kind: 'episode',
          title: 'Arrival',
          season: 2,
          episode: 4,
          episodeName: 'Home',
        },
      ],
      failedTitles: { count: 0, names: [] },
    });
    const view = await render(<CalendarDayScreen />);
    await waitFor(() => expect(view.getByText('Arrival')).toBeTruthy());
    expect(view.getByText('Season 2 · Episode 4')).toBeTruthy();
    mockDate = '2026-09-03';
    await view.rerender(<CalendarDayScreen />);
    expect(view.getByText('No releases')).toBeTruthy();
    mockDate = '2026-09-02';
    await view.rerender(<CalendarDayScreen />);
    expect(view.getByText('Home')).toBeTruthy();
    expect(mockUpcoming).toHaveBeenCalledTimes(1);
    expect(mockUpcoming).toHaveBeenCalledWith({
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      region: expect.any(String),
      cachedOnly: true,
      timeZoneOffsetMinutes: expect.any(Number),
    });
  });

  it('never shows an empty schedule for a failed load and can retry', async () => {
    mockDate = '2026-09-02';
    mockUpcoming.mockRejectedValueOnce(new Error('offline'));
    const view = await render(<CalendarDayScreen />);
    await waitFor(() => expect(view.getByText(/Couldn’t load this day/)).toBeTruthy());
    expect(view.queryByText('No releases')).toBeNull();
    await act(async () => {
      await fireEvent.press(view.getByLabelText('Retry loading releases'));
    });
    await waitFor(() => expect(view.getByText('No releases')).toBeTruthy());
  });

  it('rejects impossible dates without sending a request', async () => {
    mockDate = '2026-99-99';
    const view = await render(<CalendarDayScreen />);
    expect(view.getByText('This calendar date is invalid.')).toBeTruthy();
    expect(mockUpcoming).not.toHaveBeenCalled();
  });

  it('blocks past months and only prefetches the next month', async () => {
    const view = await render(<CalendarScreen />);
    await waitFor(() => expect(mockUpcoming).toHaveBeenCalledTimes(2));
    expect(mockUpcoming.mock.calls.map(([args]) => args.startDate)).toEqual([
      '2026-09-01',
      '2026-10-01',
    ]);
    expect(view.getByLabelText('Previous month')).toBeDisabled();
    await fireEvent.press(view.getByLabelText('Previous month'));
    expect(mockUpcoming).toHaveBeenCalledTimes(2);
    expect(view.queryByText(/first 100/)).toBeNull();
  });

  it('does not fetch old deep links', async () => {
    mockDate = '2026-08-02';
    const view = await render(<CalendarDayScreen />);
    expect(view.getByText('The calendar shows releases from this month onward.')).toBeTruthy();
    expect(mockUpcoming).not.toHaveBeenCalled();
  });

  it('loads all library pages and keeps day details loading until the last page arrives', async () => {
    mockDate = '2026-09-02';
    let resolve!: (value: unknown) => void;
    const cursor = { status: 'watchlist', after: 'page2' };
    mockUpcoming.mockResolvedValueOnce({
      events: [],
      failedTitles: { count: 0, names: [] },
      nextCursor: cursor,
      truncated: true,
    });
    mockUpcoming.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const view = await render(<CalendarDayScreen />);
    await waitFor(() => expect(mockUpcoming).toHaveBeenCalledTimes(2));
    expect(view.queryByText('No releases')).toBeNull();
    expect(view.getByLabelText('Loading releases')).toBeTruthy();
    await act(async () =>
      resolve({
        events: [
          {
            id: 'later',
            date: mockDate,
            kind: 'episode',
            title: 'Later library title',
            season: 1,
            episode: 2,
          },
        ],
        failedTitles: { count: 0, names: [] },
        nextCursor: null,
      }),
    );
    expect(view.getByText('Later library title')).toBeTruthy();
    expect(mockUpcoming.mock.calls[1][0].cursor).toEqual(cursor);
    expect(view.queryByText(/first 100/)).toBeNull();
  });

  it('keeps cached titles visible when returning to a month', async () => {
    const now = new Date(Date.now());
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-10`;
    mockUpcoming.mockImplementation(async ({ startDate }) => ({
      events:
        startDate.slice(0, 7) === date.slice(0, 7)
          ? [{ id: 'release', date, kind: 'movie', title: 'Arrival' }]
          : [],
      failedTitles: { count: 0, names: [] },
    }));
    const view = await render(<CalendarScreen />);
    await waitFor(() => expect(view.getByText('Arrival')).toBeTruthy());
    await act(async () => {
      await fireEvent.press(view.getByLabelText('Next month'));
    });
    await act(async () => {
      await fireEvent.press(view.getByLabelText('Previous month'));
    });
    expect(view.getByText('Arrival')).toBeTruthy();
    expect(
      mockUpcoming.mock.calls.filter(([args]) => args.startDate.slice(0, 7) === date.slice(0, 7)),
    ).toHaveLength(1);
  });

  it('refreshes stale day details on focus and resume without blanking cached episodes', async () => {
    mockDate = '2026-09-02';
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const listeners: ((state: string) => void)[] = [];
    const subscription = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_type, listener) => {
        listeners.push(listener);
        return { remove: () => listeners.splice(listeners.indexOf(listener), 1) };
      });
    const release = {
      id: 'episode',
      date: mockDate,
      kind: 'episode',
      title: 'Weekly show',
      season: 1,
      episode: 2,
      episodeName: 'Original name',
    };
    mockUpcoming.mockResolvedValue({ events: [release], failedTitles: { count: 0, names: [] } });
    const view = await render(<CalendarDayScreen />);
    await waitFor(() => expect(view.getByText('Original name')).toBeTruthy());
    mockFocused = false;
    await view.rerender(<CalendarDayScreen />);
    expect(listeners).toHaveLength(0);
    now.mockReturnValue(1_000_000 + 5 * 60_000);
    let resolve!: (value: unknown) => void;
    mockUpcoming.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    mockFocused = true;
    await view.rerender(<CalendarDayScreen />);
    expect(mockUpcoming).toHaveBeenCalledTimes(2);
    expect(view.getByText('Original name')).toBeTruthy();
    expect(view.queryByLabelText('Loading releases')).toBeNull();
    await act(async () =>
      resolve({
        events: [{ ...release, episodeName: 'Updated name' }],
        failedTitles: { count: 0, names: [] },
      }),
    );
    expect(view.getByText('Updated name')).toBeTruthy();
    now.mockReturnValue(1_000_000 + 10 * 60_000);
    await act(async () => listeners[0]('active'));
    expect(mockUpcoming).toHaveBeenCalledTimes(3);
    now.mockRestore();
    subscription.mockRestore();
  });
});
