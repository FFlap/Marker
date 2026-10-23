import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockRefreshWatching = jest.fn().mockResolvedValue(null);
const mockSetEpisode = jest.fn().mockResolvedValue(undefined);
const mockOverview = {
  watching: [
    {
      itemId: 'one-piece',
      title: 'One Piece',
      genres: ['Anime'],
      season: 2,
      seasonName: 'Grand Line Arc',
      episode: 62,
      name: 'The First Line of Defense',
      runtime: 24,
      airDate: '2001-05-27',
      overview: 'The crew reaches the Grand Line.',
      tags: [],
    },
  ],
  favorites: [
    {
      itemId: 'kaguya',
      title: 'Kaguya-sama: Love Is War',
      genres: ['Anime'],
      season: 2,
      episode: 3,
      name: 'Miyuki Shirogane Wants to Gaze at the Moon',
      runtime: 24,
      airDate: '2020-04-25',
      overview: 'The student council spends an evening beneath the moon.',
      rating: 5,
      tags: ['Comedy'],
    },
    {
      itemId: 'frieren',
      title: 'Frieren',
      genres: ['Anime'],
      season: 1,
      episode: 1,
      name: 'The Journey’s End',
      runtime: 24,
      airDate: '2023-09-29',
      overview: 'A new journey begins.',
      rating: 4,
      tags: ['Fantasy'],
    },
  ],
};

jest.mock('convex/react', () => ({
  useQuery: () => mockOverview,
  useMutation: (ref: string) =>
    ref === 'episodeHub.refreshWatching' ? mockRefreshWatching : mockSetEpisode,
}));
jest.mock('@marker/shared/api', () => ({
  api: {
    episodeHub: {
      overview: 'episodeHub.overview',
      refreshWatching: 'episodeHub.refreshWatching',
    },
    library: { episodes: { setEpisodeState: 'library/episodes:setEpisodeState' } },
  },
}));
jest.mock('../../src/components/AppDrawer', () => ({
  AppDrawer: () => null,
}));
jest.mock('expo-image', () => ({ Image: require('react-native').Image }));
jest.mock('../../src/components/ui/drawer', () => {
  const React = require('react');
  const { Text, View } = require('react-native');
  const CloseContext = React.createContext(() => undefined);
  const container = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  return {
    Drawer: ({
      children,
      onOpenChange,
    }: {
      children: React.ReactNode;
      onOpenChange: (open: boolean) => void;
    }) => (
      <CloseContext.Provider value={() => onOpenChange(false)}>
        <View>{children}</View>
      </CloseContext.Provider>
    ),
    DrawerClose: ({ children }: { children: React.ReactElement }) =>
      React.cloneElement(children, { onPress: React.useContext(CloseContext) }),
    DrawerContent: container,
    DrawerHeader: container,
    DrawerTitle: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>,
    DrawerTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

import EpisodesScreen from '../../src/app/(tabs)/episodes';
import { ToastProvider } from '../../src/components/ui/Toast';

beforeEach(() => {
  mockRefreshWatching.mockReset().mockResolvedValue(null);
  mockSetEpisode.mockReset().mockResolvedValue(undefined);
});

function deferred() {
  let reject!: (error: Error) => void;
  let resolve!: () => void;
  const promise = new Promise<void>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
}

it('expands episode details, tracks the next episode, and keeps editing in the options menu', async () => {
  const view = await render(
    <ToastProvider>
      <EpisodesScreen />
    </ToastProvider>,
  );
  expect(view.getByText('One Piece')).toBeTruthy();
  expect(view.getByText('The First Line of Defense')).toBeTruthy();
  expect(view.queryByText('EP 62')).toBeNull();
  expect(view.queryByText('24 min')).toBeNull();
  expect(view.getByText('The crew reaches the Grand Line.')).toBeTruthy();

  await fireEvent.press(view.getByLabelText('View One Piece, episode 62'));
  expect(view.getByText('EP 62')).toBeTruthy();
  expect(view.getByText('24 min')).toBeTruthy();
  expect(view.getByText('The crew reaches the Grand Line.')).toBeTruthy();
  expect(view.getByText('Aired 2001-05-27')).toBeTruthy();

  await fireEvent.press(view.getByLabelText('Mark One Piece episode 62 watched'));
  await waitFor(() =>
    expect(mockSetEpisode).toHaveBeenCalledWith({
      itemId: 'one-piece',
      season: 2,
      episode: 62,
      seasonName: 'Grand Line Arc',
      name: 'The First Line of Defense',
      overview: 'The crew reaches the Grand Line.',
      runtime: 24,
      airDate: '2001-05-27',
      watched: true,
      activityDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    }),
  );
  await fireEvent.press(view.getByRole('tab', { name: 'Favorites' }));
  expect(view.getByText('Miyuki Shirogane Wants to Gaze at the Moon')).toBeTruthy();
  expect(view.getByLabelText('Rated 5 out of 5 stars')).toBeTruthy();
  expect(view.getByText('The student council spends an evening beneath the moon.')).toBeTruthy();
  await fireEvent.press(view.getByLabelText('View Kaguya-sama: Love Is War, episode 3'));
  expect(view.getByText('The student council spends an evening beneath the moon.')).toBeTruthy();
  expect(view.getByText('EP 03')).toBeTruthy();
  expect(view.getByText('24 min')).toBeTruthy();
  expect(view.getByText('Aired 2020-04-25')).toBeTruthy();
  await fireEvent.press(view.getByLabelText('Kaguya-sama: Love Is War episode 3 options'));
  expect(view.getAllByText('Tags').length).toBeGreaterThan(0);
  expect(view.getByText('Mark episode unwatched')).toBeTruthy();
  await fireEvent.changeText(view.getByPlaceholderText('Add a tag'), 'Romance');
  await fireEvent.press(view.getByLabelText('Create tag Romance'));
  await waitFor(() =>
    expect(mockSetEpisode).toHaveBeenCalledWith({
      itemId: 'kaguya',
      season: 2,
      episode: 3,
      name: 'Miyuki Shirogane Wants to Gaze at the Moon',
      overview: 'The student council spends an evening beneath the moon.',
      runtime: 24,
      airDate: '2020-04-25',
      tags: ['Comedy', 'Romance'],
    }),
  );
  expect(view.getByLabelText('Search favorites episodes')).toBeTruthy();
  expect(view.getByLabelText('Filter favorites episodes')).toBeTruthy();
  expect(view.getByRole('radio', { name: 'Comedy' })).toBeTruthy();
});

it('reports a refresh failure without repeatedly scheduling repair', async () => {
  mockRefreshWatching.mockClear().mockRejectedValueOnce(new Error('offline'));
  const view = await render(
    <ToastProvider>
      <EpisodesScreen />
    </ToastProvider>,
  );
  await waitFor(() => expect(view.getByText('Couldn’t refresh your episodes')).toBeTruthy());
  expect(mockRefreshWatching).toHaveBeenCalledTimes(1);
  expect(view.getByText('One Piece')).toBeTruthy();
});

it('keeps the newest rating when an earlier queued save fails', async () => {
  const first = deferred();
  mockSetEpisode.mockReturnValueOnce(first.promise);
  const view = await render(
    <ToastProvider>
      <EpisodesScreen />
    </ToastProvider>,
  );
  await fireEvent.press(view.getByRole('tab', { name: 'Favorites' }));
  await fireEvent.press(view.getByLabelText('Kaguya-sama: Love Is War episode 3 options'));
  await fireEvent.press(view.getByLabelText('Rate 4 stars'));
  await fireEvent.press(view.getByLabelText('Rate 3 stars'));
  expect(mockSetEpisode).toHaveBeenCalledTimes(1);

  await act(async () => first.reject(new Error('offline')));
  await waitFor(() => expect(mockSetEpisode).toHaveBeenCalledTimes(2));
  expect(mockSetEpisode).toHaveBeenLastCalledWith(expect.objectContaining({ rating: 3 }));
  expect(view.getByLabelText('Current rating')).toHaveAccessibilityValue({
    text: '3 out of 5 stars',
  });
});

it('restores the last saved rating when all queued changes fail', async () => {
  const first = deferred();
  mockSetEpisode.mockReturnValueOnce(first.promise).mockRejectedValueOnce(new Error('offline'));
  const view = await render(
    <ToastProvider>
      <EpisodesScreen />
    </ToastProvider>,
  );
  await fireEvent.press(view.getByRole('tab', { name: 'Favorites' }));
  await fireEvent.press(view.getByLabelText('Kaguya-sama: Love Is War episode 3 options'));
  await fireEvent.press(view.getByLabelText('Rate 4 stars'));
  await fireEvent.press(view.getByLabelText('Rate 3 stars'));

  await act(async () => first.reject(new Error('offline')));
  await waitFor(() => expect(mockSetEpisode).toHaveBeenCalledTimes(2));
  expect(view.getByLabelText('Current rating')).toHaveAccessibilityValue({
    text: '5 out of 5 stars',
  });
});

it('rolls a failed rating back to the preceding successful save', async () => {
  const first = deferred();
  mockSetEpisode.mockReturnValueOnce(first.promise).mockRejectedValueOnce(new Error('offline'));
  const view = await render(
    <ToastProvider>
      <EpisodesScreen />
    </ToastProvider>,
  );
  await fireEvent.press(view.getByRole('tab', { name: 'Favorites' }));
  await fireEvent.press(view.getByLabelText('Kaguya-sama: Love Is War episode 3 options'));
  await fireEvent.press(view.getByLabelText('Rate 4 stars'));
  await fireEvent.press(view.getByLabelText('Rate 3 stars'));

  await act(async () => first.resolve());
  await waitFor(() => expect(mockSetEpisode).toHaveBeenCalledTimes(2));
  expect(view.getByLabelText('Current rating')).toHaveAccessibilityValue({
    text: '4 out of 5 stars',
  });
});

it.each(['rating', 'tags'] as const)(
  'prevents reopening the same episode until all queued %s saves settle',
  async (field) => {
    const first = deferred();
    const second = deferred();
    mockSetEpisode.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const view = await render(
      <ToastProvider>
        <EpisodesScreen />
      </ToastProvider>,
    );
    const optionsLabel = 'Kaguya-sama: Love Is War episode 3 options';
    await fireEvent.press(view.getByRole('tab', { name: 'Favorites' }));
    await fireEvent.press(view.getByLabelText(optionsLabel));
    if (field === 'rating') {
      await fireEvent.press(view.getByLabelText('Rate 4 stars'));
      await fireEvent.press(view.getByLabelText('Rate 3 stars'));
    } else {
      await fireEvent.changeText(view.getByPlaceholderText('Add a tag'), 'Romance');
      await fireEvent.press(view.getByLabelText('Create tag Romance'));
      await fireEvent.press(view.getByLabelText('Remove Comedy tag'));
    }
    expect(mockSetEpisode).toHaveBeenCalledTimes(1);
    await fireEvent.press(view.getAllByText('Done').at(-1)!);

    expect(view.getByLabelText(optionsLabel)).toBeDisabled();
    await fireEvent.press(view.getByLabelText(optionsLabel));
    expect(view.queryByLabelText('Current rating')).toBeNull();
    expect(view.queryByPlaceholderText('Add a tag')).toBeNull();
    expect(view.getByLabelText('Frieren episode 1 options')).toBeEnabled();

    await act(async () => first.resolve());
    await waitFor(() => expect(mockSetEpisode).toHaveBeenCalledTimes(2));
    expect(mockSetEpisode).toHaveBeenLastCalledWith(
      expect.objectContaining(field === 'rating' ? { rating: 3 } : { tags: ['Romance'] }),
    );
    expect(view.getByLabelText(optionsLabel)).toBeDisabled();
    await fireEvent.press(view.getByLabelText(optionsLabel));
    expect(view.queryByLabelText('Current rating')).toBeNull();
    expect(view.queryByPlaceholderText('Add a tag')).toBeNull();

    await act(async () => second.reject(new Error('offline')));
    await waitFor(() => expect(view.getByLabelText(optionsLabel)).toBeEnabled());
    expect(view.getByText('Couldn’t update this episode')).toBeTruthy();
    await fireEvent.press(view.getByLabelText(optionsLabel));
    expect(view.getByLabelText('Current rating')).toBeTruthy();
    expect(view.getByPlaceholderText('Add a tag')).toBeTruthy();
    expect(mockSetEpisode).toHaveBeenCalledTimes(2);
  },
);

it('restores saved tags when queued changes fail without rolling back a saved rating', async () => {
  const first = deferred();
  mockSetEpisode
    .mockReturnValueOnce(first.promise)
    .mockRejectedValueOnce(new Error('offline'))
    .mockRejectedValueOnce(new Error('offline'));
  const view = await render(
    <ToastProvider>
      <EpisodesScreen />
    </ToastProvider>,
  );
  await fireEvent.press(view.getByRole('tab', { name: 'Favorites' }));
  await fireEvent.press(view.getByLabelText('Kaguya-sama: Love Is War episode 3 options'));
  await fireEvent.press(view.getByLabelText('Rate 4 stars'));
  await fireEvent.changeText(view.getByPlaceholderText('Add a tag'), 'Romance');
  await fireEvent.press(view.getByLabelText('Create tag Romance'));
  await fireEvent.press(view.getByLabelText('Remove Comedy tag'));

  await act(async () => first.resolve());
  await waitFor(() => expect(mockSetEpisode).toHaveBeenCalledTimes(3));
  expect(view.getByLabelText('Remove Comedy tag')).toBeTruthy();
  expect(view.queryByLabelText('Remove Romance tag')).toBeNull();
  expect(view.getByLabelText('Current rating')).toHaveAccessibilityValue({
    text: '4 out of 5 stars',
  });
});

it('does not restore another episode’s tags after closing and reopening the editor', async () => {
  const first = deferred();
  mockSetEpisode.mockReturnValueOnce(first.promise);
  const view = await render(
    <ToastProvider>
      <EpisodesScreen />
    </ToastProvider>,
  );
  await fireEvent.press(view.getByRole('tab', { name: 'Favorites' }));
  await fireEvent.press(view.getByLabelText('Kaguya-sama: Love Is War episode 3 options'));
  await fireEvent.changeText(view.getByPlaceholderText('Add a tag'), 'Romance');
  await fireEvent.press(view.getByLabelText('Create tag Romance'));
  await fireEvent.press(view.getAllByText('Done').at(-1)!);
  await fireEvent.press(view.getByLabelText('Frieren episode 1 options'));

  await act(async () => first.reject(new Error('offline')));
  expect(view.getByLabelText('Remove Fantasy tag')).toBeTruthy();
  expect(view.queryByLabelText('Remove Comedy tag')).toBeNull();
});
